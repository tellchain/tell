use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("only the envelope program may call this, for an opened envelope of this pool's line")]
    NotEnvelope,
    #[msg("an account does not match")]
    AccountMismatch,
    #[msg("zero amount")]
    ZeroAmount,
    #[msg("base and quote are the same mint")]
    SameMint,
    #[msg("a mint with a freeze authority cannot be pooled")]
    FreezableMint,
}
