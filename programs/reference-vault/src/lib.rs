#![allow(unexpected_cfgs)]

//! A deliberately ordinary tokenized-stock vault. It prices shares with the
//! stored Scaled UI multiplier, the most common integration mistake. The two
//! redeem instructions run identical math. The only difference is that
//! `redeem_guarded` asks NAVGuard first, and NAVGuard aborts the transaction when
//! the multiplier the vault is about to use is no longer the effective one.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

pub mod math;

declare_id!("3mELb3aUhBEtWX3uQoCfLCs5M68Wn8YUTJwdkQZDYKZM");

/// Tolerance passed to NAVGuard. 5 bps absorbs f64 to e9 rounding and nothing more.
pub const GUARD_MAX_DEVIATION_BPS: u16 = 5;

#[program]
pub mod reference_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.mint = ctx.accounts.mint.key();
        vault.total_shares = 0;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit<'info>(
        ctx: Context<'info, Deposit<'info>>,
        raw_amount: u64,
    ) -> Result<()> {
        let multiplier_e9 = stale_multiplier(&ctx.accounts.mint)?;
        let shares = math::shares_for_deposit(raw_amount, multiplier_e9)
            .ok_or(error!(VaultError::MathOverflow))?;
        require!(shares > 0, VaultError::ZeroShares);

        let cpi = CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_token.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        )
        .with_remaining_accounts(ctx.remaining_accounts.to_vec());
        token_interface::transfer_checked(cpi, raw_amount, ctx.accounts.mint.decimals)?;

        let owner = ctx.accounts.user.key();
        let position = &mut ctx.accounts.position;
        position.owner = owner;
        position.shares = position
            .shares
            .checked_add(shares)
            .ok_or(error!(VaultError::MathOverflow))?;
        let vault = &mut ctx.accounts.vault;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares)
            .ok_or(error!(VaultError::MathOverflow))?;
        emit!(Deposited {
            owner,
            raw_amount,
            shares,
            multiplier_e9
        });
        Ok(())
    }

    /// Vulnerable path. Pays out using the stale multiplier.
    pub fn redeem_unguarded<'info>(
        ctx: Context<'info, Redeem<'info>>,
        shares: u64,
    ) -> Result<()> {
        let multiplier_e9 = stale_multiplier(&ctx.accounts.mint)?;
        settle_redeem(ctx, shares, multiplier_e9, false)
    }

    /// Same math, but NAVGuard verifies the multiplier through CPI first. A stale
    /// multiplier, paused mint, or activation window reverts the whole transaction.
    pub fn redeem_guarded<'info>(
        ctx: Context<'info, Redeem<'info>>,
        shares: u64,
    ) -> Result<()> {
        let multiplier_e9 = stale_multiplier(&ctx.accounts.mint)?;
        navguard::cpi::assert_safe_nav(
            CpiContext::new(
                ctx.accounts.navguard_program.key(),
                navguard::cpi::accounts::Evaluate {
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            multiplier_e9,
            GUARD_MAX_DEVIATION_BPS,
        )?;
        settle_redeem(ctx, shares, multiplier_e9, true)
    }
}

fn stale_multiplier(mint: &InterfaceAccount<'_, Mint>) -> Result<u64> {
    let info = mint.to_account_info();
    let data = info.try_borrow_data()?;
    math::stored_multiplier_e9(&data).ok_or(error!(VaultError::MissingScaledUiAmount))
}

fn settle_redeem<'info>(
    ctx: Context<'info, Redeem<'info>>,
    shares: u64,
    multiplier_e9: u64,
    guarded: bool,
) -> Result<()> {
    require!(shares > 0, VaultError::ZeroShares);
    require!(
        ctx.accounts.position.shares >= shares,
        VaultError::InsufficientShares
    );
    let raw_out =
        math::raw_for_redeem(shares, multiplier_e9).ok_or(error!(VaultError::MathOverflow))?;

    let mint_key = ctx.accounts.mint.key();
    let bump = [ctx.accounts.vault.bump];
    let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &bump];
    let signer = [seeds];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.vault_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        &signer,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());
    token_interface::transfer_checked(cpi, raw_out, ctx.accounts.mint.decimals)?;

    let owner = ctx.accounts.user.key();
    ctx.accounts.position.shares -= shares;
    let vault = &mut ctx.accounts.vault;
    vault.total_shares = vault
        .total_shares
        .checked_sub(shares)
        .ok_or(error!(VaultError::MathOverflow))?;
    emit!(Redeemed {
        owner,
        shares,
        raw_out,
        multiplier_e9,
        guarded
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = vault.bump, has_one = mint)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"position", vault.key().as_ref(), user.key().as_ref()],
        bump,
        constraint = position.owner == user.key() @ VaultError::InsufficientShares,
    )]
    pub position: Account<'info, Position>,
    pub navguard_program: Program<'info, navguard::program::Navguard>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub mint: Pubkey,
    pub total_shares: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub shares: u64,
}

#[event]
pub struct Deposited {
    pub owner: Pubkey,
    pub raw_amount: u64,
    pub shares: u64,
    pub multiplier_e9: u64,
}

#[event]
pub struct Redeemed {
    pub owner: Pubkey,
    pub shares: u64,
    pub raw_out: u64,
    pub multiplier_e9: u64,
    pub guarded: bool,
}

#[error_code]
pub enum VaultError {
    #[msg("Share math overflowed")]
    MathOverflow,
    #[msg("Amount produces zero shares")]
    ZeroShares,
    #[msg("Position does not hold enough shares")]
    InsufficientShares,
    #[msg("Mint has no Scaled UI Amount extension")]
    MissingScaledUiAmount,
}
