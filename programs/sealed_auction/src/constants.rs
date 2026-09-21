use anchor_lang::prelude::*;

pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const LOT_OPEN: u8 = 0;
pub const LOT_SETTLED: u8 = 1;
pub const LOT_NO_BID: u8 = 2;
pub const REASON_OK: u8 = 0;
pub const REASON_BELOW_RESERVE: u8 = 1;
pub const REASON_CAP: u8 = 2;
pub const REASON_BAD_PAYLOAD: u8 = 3;
pub const REASON_ACCOUNTS: u8 = 4;
pub const REASON_ZERO: u8 = 6;
pub const REASON_OUTBID: u8 = 7;
