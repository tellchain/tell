use anchor_lang::prelude::*;

#[error_code]
pub enum AuctionError {
    #[msg("only the envelope program may call this, for an opened envelope of this lot's line")]
    NotEnvelope,
    #[msg("an account does not match")]
    AccountMismatch,
    #[msg("zero amount")]
    ZeroAmount,
    #[msg("the closing slot must be in the future")]
    BadClose,
    #[msg("the lot is already settled")]
    Settled,
    #[msg("bids can still be sealed or opened")]
    NotClosed,
    #[msg("some bids are not executed yet")]
    BidsPending,
    #[msg("a mint with a freeze authority cannot be auctioned or bid")]
    FreezableMint,
}
