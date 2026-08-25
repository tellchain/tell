use anchor_lang::prelude::*;

pub const DOMAIN: &[u8] = b"blindfold:v1";
pub const MAX_CONTENT: usize = 640;
pub const MAX_ESCROWS: usize = 2;
pub const MAX_WINDOW: u64 = 3000;
pub const MIN_STALE_SLOTS: u64 = 150;
pub const MAX_STALE_SLOTS: u64 = 216_000;
pub const ATA_DEPOSIT_COUNT: u64 = 4;
pub const NATIVE_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const TOKEN_ACCOUNT_LEN: u64 = 165;
pub const STATE_SEALED: u8 = 0;
pub const STATE_OPENED: u8 = 1;
pub const STATE_EXECUTED: u8 = 2;
pub const STATE_SKIPPED: u8 = 3;
pub const STATE_VOIDED: u8 = 4;
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const RESULT_LEN: usize = 3;
