//! Share accounting for the reference vault.
//!
//! Shares are denominated in economic units: raw token amount multiplied by the
//! Token-2022 Scaled UI multiplier. That keeps one share equal to one unit of the
//! underlying stock across dividends and splits.

use navguard_core::MULTIPLIER_SCALE;
use spl_token_2022_interface::{
    extension::{
        scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, PodStateWithExtensions,
    },
    pod::PodMint,
};

pub fn shares_for_deposit(raw_amount: u64, multiplier_e9: u64) -> Option<u64> {
    let shares = (raw_amount as u128)
        .checked_mul(multiplier_e9 as u128)?
        .checked_div(MULTIPLIER_SCALE as u128)?;
    u64::try_from(shares).ok()
}

pub fn raw_for_redeem(shares: u64, multiplier_e9: u64) -> Option<u64> {
    if multiplier_e9 == 0 {
        return None;
    }
    let raw = (shares as u128)
        .checked_mul(MULTIPLIER_SCALE as u128)?
        .checked_div(multiplier_e9 as u128)?;
    u64::try_from(raw).ok()
}

/// THE BUG, on purpose. Reads the `multiplier` field of the Scaled UI Amount
/// extension and ignores `new_multiplier` and its activation timestamp. After a
/// dividend or split activates, this value is stale.
pub fn stored_multiplier_e9(mint_data: &[u8]) -> Option<u64> {
    let mint = PodStateWithExtensions::<PodMint>::unpack(mint_data).ok()?;
    let scaled = mint.get_extension::<ScaledUiAmountConfig>().ok()?;
    let multiplier: f64 = scaled.multiplier.into();
    to_e9(multiplier)
}

/// The correct read: selects `new_multiplier` once its activation time passes.
pub fn effective_multiplier_e9(mint_data: &[u8], now: i64) -> Option<u64> {
    let mint = PodStateWithExtensions::<PodMint>::unpack(mint_data).ok()?;
    let scaled = mint.get_extension::<ScaledUiAmountConfig>().ok()?;
    let activation: i64 = scaled.new_multiplier_effective_timestamp.into();
    let multiplier: f64 = if now >= activation {
        scaled.new_multiplier.into()
    } else {
        scaled.multiplier.into()
    };
    to_e9(multiplier)
}

fn to_e9(multiplier: f64) -> Option<u64> {
    let scaled = multiplier * MULTIPLIER_SCALE as f64;
    (scaled.is_finite() && scaled > 0.0 && scaled <= u64::MAX as f64).then_some(scaled as u64)
}
