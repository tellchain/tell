use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("the minimum received was not met")]
    Slippage,
    #[msg("zero amount")]
    ZeroAmount,
    #[msg("the pool is empty")]
    EmptyPool,
    #[msg("side is 0 (buy base) or 1 (sell base)")]
    BadSide,
    #[msg("base and quote are the same mint")]
    SameMint,
    #[msg("a mint with a freeze authority cannot be pooled")]
    FreezableMint,
}
