#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use navguard_core::{
    evaluate as evaluate_policy, GuardInput, GuardReason as CoreReason, GuardReport as CoreReport,
    GuardState as CoreState, MULTIPLIER_SCALE,
};
use spl_token_2022_interface::{
    extension::{
        pausable::PausableConfig, scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions,
        PodStateWithExtensions,
    },
    pod::PodMint,
};

declare_id!("GFmZc6zgoYHStU2gU6cZem4sDEtJhHhdGMRCRuXBb7KA");

const DEFAULT_ACTIVATION_WINDOW_SECONDS: u32 = 15 * 60;
/// Prevent integrations from accidentally opting out of the guard with a
/// permissive caller-supplied tolerance. Five bps is the reference default;
/// one percent is the absolute maximum accepted by the program.
const MAX_DEVIATION_BPS: u16 = 100;

#[program]
pub mod navguard {
    use super::*;

    /// Returns the guard report without rejecting AMBER or RED. Integrators can
    /// use this for previews and transaction simulation.
    pub fn evaluate(
        ctx: Context<Evaluate>,
        expected_multiplier_e9: u64,
        max_deviation_bps: u16,
    ) -> Result<GuardReport> {
        require!(
            max_deviation_bps <= MAX_DEVIATION_BPS,
            NavGuardError::InvalidDeviationThreshold
        );
        inspect_mint(
            &ctx.accounts.mint,
            expected_multiplier_e9,
            max_deviation_bps,
            Clock::get()?.unix_timestamp,
        )
    }

    /// CPI enforcement path. A vault passes the multiplier used in its own NAV
    /// calculation. Any stale value, paused mint, invalid extension state, or
    /// activation window aborts the parent transaction atomically.
    pub fn assert_safe_nav(
        ctx: Context<Evaluate>,
        expected_multiplier_e9: u64,
        max_deviation_bps: u16,
    ) -> Result<GuardReport> {
        require!(
            expected_multiplier_e9 > 0,
            NavGuardError::InvalidExpectedMultiplier
        );
        require!(
            max_deviation_bps <= MAX_DEVIATION_BPS,
            NavGuardError::InvalidDeviationThreshold
        );
        let report = inspect_mint(
            &ctx.accounts.mint,
            expected_multiplier_e9,
            max_deviation_bps,
            Clock::get()?.unix_timestamp,
        )?;

        match report.state {
            GuardState::Green => Ok(report),
            GuardState::Amber => err!(NavGuardError::ActivationWindow),
            GuardState::Red => match report.reason {
                GuardReason::MintPaused => err!(NavGuardError::MintPaused),
                GuardReason::MultiplierMismatch => err!(NavGuardError::MultiplierMismatch),
                GuardReason::InvalidMultiplier => err!(NavGuardError::InvalidMultiplier),
                _ => err!(NavGuardError::UnsafeMint),
            },
        }
    }
}

#[derive(Accounts)]
pub struct Evaluate<'info> {
    /// CHECK: owner and Token-2022 extension layout are validated in inspect_mint.
    pub mint: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuardState {
    Green,
    Amber,
    Red,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuardReason {
    Safe,
    ActivationWindow,
    MintPaused,
    MultiplierMismatch,
    InvalidMultiplier,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct GuardReport {
    pub state: GuardState,
    pub reason: GuardReason,
    pub current_multiplier_e9: u64,
    pub effective_multiplier_e9: u64,
    pub activation_timestamp: i64,
    pub deviation_bps: u64,
    pub has_pausable_config: bool,
}

fn inspect_mint(
    mint_account: &UncheckedAccount<'_>,
    expected_multiplier_e9: u64,
    max_deviation_bps: u16,
    now: i64,
) -> Result<GuardReport> {
    let data = mint_account.try_borrow_data()?;
    inspect_mint_data(
        mint_account.owner,
        &data,
        expected_multiplier_e9,
        max_deviation_bps,
        now,
    )
}

/// Evaluates raw Token-2022 mint bytes. The on-chain instructions and off-chain
/// tests share this path, so a captured mainnet account exercises exactly the
/// logic that runs inside the program.
pub fn inspect_mint_data(
    owner: &Pubkey,
    data: &[u8],
    expected_multiplier_e9: u64,
    max_deviation_bps: u16,
    now: i64,
) -> Result<GuardReport> {
    require!(
        owner.to_bytes() == spl_token_2022_interface::id().to_bytes(),
        NavGuardError::InvalidMintOwner
    );

    let mint = PodStateWithExtensions::<PodMint>::unpack(data)
        .map_err(|_| error!(NavGuardError::InvalidMintData))?;
    let scaled = mint
        .get_extension::<ScaledUiAmountConfig>()
        .map_err(|_| error!(NavGuardError::MissingScaledUiAmount))?;
    let pausable = mint.get_extension::<PausableConfig>().ok();

    let current_multiplier: f64 = scaled.multiplier.into();
    let new_multiplier: f64 = scaled.new_multiplier.into();
    require!(
        current_multiplier.is_finite()
            && new_multiplier.is_finite()
            && current_multiplier > 0.0
            && new_multiplier > 0.0,
        NavGuardError::InvalidMultiplier
    );

    let input = GuardInput {
        now,
        current_multiplier_e9: to_e9(current_multiplier)?,
        new_multiplier_e9: to_e9(new_multiplier)?,
        activation_timestamp: scaled.new_multiplier_effective_timestamp.into(),
        is_paused: pausable
            .map(|config| bool::from(config.paused))
            .unwrap_or(false),
        expected_multiplier_e9,
        max_deviation_bps,
        activation_window_seconds: DEFAULT_ACTIVATION_WINDOW_SECONDS,
    };

    Ok(map_report(evaluate_policy(input), pausable.is_some()))
}

fn to_e9(multiplier: f64) -> Result<u64> {
    let scaled = multiplier * MULTIPLIER_SCALE as f64;
    require!(
        scaled.is_finite() && scaled > 0.0 && scaled <= u64::MAX as f64,
        NavGuardError::InvalidMultiplier
    );
    Ok(scaled as u64)
}

fn map_report(report: CoreReport, has_pausable_config: bool) -> GuardReport {
    GuardReport {
        state: match report.state {
            CoreState::Green => GuardState::Green,
            CoreState::Amber => GuardState::Amber,
            CoreState::Red => GuardState::Red,
        },
        reason: match report.reason {
            CoreReason::Safe => GuardReason::Safe,
            CoreReason::ActivationWindow => GuardReason::ActivationWindow,
            CoreReason::MintPaused => GuardReason::MintPaused,
            CoreReason::MultiplierMismatch => GuardReason::MultiplierMismatch,
            CoreReason::InvalidMultiplier => GuardReason::InvalidMultiplier,
        },
        current_multiplier_e9: report.current_multiplier_e9,
        effective_multiplier_e9: report.effective_multiplier_e9,
        activation_timestamp: report.activation_timestamp,
        deviation_bps: report.deviation_bps,
        has_pausable_config,
    }
}

#[error_code]
pub enum NavGuardError {
    #[msg("The supplied account is not owned by Token-2022")]
    InvalidMintOwner,
    #[msg("The supplied account is not a valid Token-2022 mint")]
    InvalidMintData,
    #[msg("The mint does not contain the Scaled UI Amount extension")]
    MissingScaledUiAmount,
    #[msg("The mint multiplier is invalid")]
    InvalidMultiplier,
    #[msg("The caller must provide the multiplier used in its NAV calculation")]
    InvalidExpectedMultiplier,
    #[msg("The deviation threshold must be at most 100 bps")]
    InvalidDeviationThreshold,
    #[msg("The mint is currently paused")]
    MintPaused,
    #[msg("The caller multiplier differs from the effective on-chain multiplier")]
    MultiplierMismatch,
    #[msg("The mint is inside the multiplier activation safety window")]
    ActivationWindow,
    #[msg("The mint is not safe for NAV-sensitive settlement")]
    UnsafeMint,
}
