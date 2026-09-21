#![no_std]

pub const MULTIPLIER_SCALE: u64 = 1_000_000_000;
pub const BPS_SCALE: u128 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum GuardState {
    Green = 0,
    Amber = 1,
    Red = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum GuardReason {
    Safe = 0,
    ActivationWindow = 1,
    MintPaused = 2,
    MultiplierMismatch = 3,
    InvalidMultiplier = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GuardInput {
    pub now: i64,
    pub current_multiplier_e9: u64,
    pub new_multiplier_e9: u64,
    pub activation_timestamp: i64,
    pub is_paused: bool,
    /// The multiplier the calling vault intends to use. A zero value skips the
    /// caller comparison for read-only evaluation.
    pub expected_multiplier_e9: u64,
    pub max_deviation_bps: u16,
    pub activation_window_seconds: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GuardReport {
    pub state: GuardState,
    pub reason: GuardReason,
    pub current_multiplier_e9: u64,
    pub effective_multiplier_e9: u64,
    pub activation_timestamp: i64,
    pub deviation_bps: u64,
}

pub fn effective_multiplier(input: &GuardInput) -> u64 {
    if input.now >= input.activation_timestamp {
        input.new_multiplier_e9
    } else {
        input.current_multiplier_e9
    }
}

pub fn deviation_bps(expected: u64, effective: u64) -> u64 {
    if effective == 0 {
        return u64::MAX;
    }
    let difference = expected.abs_diff(effective) as u128;
    let bps = difference
        .saturating_mul(BPS_SCALE)
        .checked_div(effective as u128)
        .unwrap_or(u128::MAX);
    bps.min(u64::MAX as u128) as u64
}

pub fn evaluate(input: GuardInput) -> GuardReport {
    let effective = effective_multiplier(&input);
    let observed_deviation = if input.expected_multiplier_e9 == 0 {
        0
    } else {
        deviation_bps(input.expected_multiplier_e9, effective)
    };

    let base = GuardReport {
        state: GuardState::Green,
        reason: GuardReason::Safe,
        current_multiplier_e9: input.current_multiplier_e9,
        effective_multiplier_e9: effective,
        activation_timestamp: input.activation_timestamp,
        deviation_bps: observed_deviation,
    };

    if input.current_multiplier_e9 == 0 || input.new_multiplier_e9 == 0 || effective == 0 {
        return GuardReport {
            state: GuardState::Red,
            reason: GuardReason::InvalidMultiplier,
            ..base
        };
    }

    if input.is_paused {
        return GuardReport {
            state: GuardState::Red,
            reason: GuardReason::MintPaused,
            ..base
        };
    }

    if input.expected_multiplier_e9 != 0 && observed_deviation > u64::from(input.max_deviation_bps)
    {
        return GuardReport {
            state: GuardState::Red,
            reason: GuardReason::MultiplierMismatch,
            ..base
        };
    }

    if input.activation_timestamp > 0
        && input.now.abs_diff(input.activation_timestamp)
            <= u64::from(input.activation_window_seconds)
    {
        return GuardReport {
            state: GuardState::Amber,
            reason: GuardReason::ActivationWindow,
            ..base
        };
    }

    base
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normal_input() -> GuardInput {
        GuardInput {
            now: 2_000,
            current_multiplier_e9: MULTIPLIER_SCALE,
            new_multiplier_e9: 1_010_000_000,
            activation_timestamp: 3_000,
            is_paused: false,
            expected_multiplier_e9: MULTIPLIER_SCALE,
            max_deviation_bps: 5,
            activation_window_seconds: 900,
        }
    }

    #[test]
    fn chooses_current_before_activation() {
        let report = evaluate(normal_input());
        assert_eq!(report.state, GuardState::Green);
        assert_eq!(report.effective_multiplier_e9, MULTIPLIER_SCALE);
    }

    #[test]
    fn enters_amber_window_before_activation() {
        let mut input = normal_input();
        input.now = 2_500;
        let report = evaluate(input);
        assert_eq!(report.state, GuardState::Amber);
        assert_eq!(report.reason, GuardReason::ActivationWindow);
    }

    #[test]
    fn rejects_a_stale_caller_multiplier_after_activation() {
        let mut input = normal_input();
        input.now = 4_000;
        let report = evaluate(input);
        assert_eq!(report.state, GuardState::Red);
        assert_eq!(report.reason, GuardReason::MultiplierMismatch);
        assert_eq!(report.effective_multiplier_e9, 1_010_000_000);
        assert_eq!(report.deviation_bps, 99);
    }

    #[test]
    fn accepts_the_effective_multiplier_after_activation() {
        let mut input = normal_input();
        input.now = 4_000;
        input.expected_multiplier_e9 = 1_010_000_000;
        let report = evaluate(input);
        assert_eq!(report.state, GuardState::Green);
    }

    #[test]
    fn rejects_a_paused_mint() {
        let mut input = normal_input();
        input.is_paused = true;
        let report = evaluate(input);
        assert_eq!(report.state, GuardState::Red);
        assert_eq!(report.reason, GuardReason::MintPaused);
    }

    #[test]
    fn catches_split_sized_error() {
        let report = evaluate(GuardInput {
            now: 10_000,
            current_multiplier_e9: MULTIPLIER_SCALE,
            new_multiplier_e9: 4 * MULTIPLIER_SCALE,
            activation_timestamp: 5_000,
            is_paused: false,
            expected_multiplier_e9: MULTIPLIER_SCALE,
            max_deviation_bps: 5,
            activation_window_seconds: 900,
        });
        assert_eq!(report.state, GuardState::Red);
        assert_eq!(report.deviation_bps, 7_500);
    }

    #[test]
    fn zero_expected_is_read_only_mode() {
        let mut input = normal_input();
        input.now = 4_000;
        input.expected_multiplier_e9 = 0;
        let report = evaluate(input);
        assert_eq!(report.state, GuardState::Green);
        assert_eq!(report.effective_multiplier_e9, 1_010_000_000);
    }
}
