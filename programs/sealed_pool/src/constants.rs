use anchor_lang::prelude::*;

pub const FEE_BPS: u16 = 25;
pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const REASON_OK: u8 = 0;
pub const REASON_SLIPPAGE: u8 = 1;
pub const REASON_CAP: u8 = 2;
pub const REASON_BAD_PAYLOAD: u8 = 3;
pub const REASON_ACCOUNTS: u8 = 4;
pub const REASON_EMPTY: u8 = 5;
pub const REASON_ZERO: u8 = 6;
