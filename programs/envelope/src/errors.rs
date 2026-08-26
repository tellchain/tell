use anchor_lang::prelude::*;

#[error_code]
pub enum EnvelopeError {
    #[msg("the open window has not started")]
    WindowNotOpen,
    #[msg("the open window has ended")]
    WindowClosed,
    #[msg("the envelope is not sealed")]
    NotSealed,
    #[msg("the envelope is not opened")]
    NotOpened,
    #[msg("content and secret do not match the fingerprint")]
    FingerprintMismatch,
    #[msg("content does not parse or breaks a limit")]
    BadContent,
    #[msg("the content names another consumer")]
    WrongConsumer,
    #[msg("the earlier place has not opened and its window is still running")]
    PrevNotOpened,
    #[msg("this envelope is not the next in line")]
    NotNextInLine,
    #[msg("the open window is not over")]
    WindowNotOver,
    #[msg("an account does not match")]
    AccountMismatch,
    #[msg("sealing on this line has closed")]
    SealingClosed,
    #[msg("the cap is zero")]
    CapZero,
    #[msg("at most two escrows")]
    TooManyEscrows,
    #[msg("bad line parameters")]
    BadParams,
    #[msg("a mint with a freeze authority cannot be escrowed or bonded")]
    FreezableMint,
    #[msg("the bond source must be the owner's associated token account")]
    BondSourceNotAta,
    #[msg("the envelope is not yet stale")]
    NotStale,
    #[msg("the native mint cannot be a bond or escrow mint")]
    NativeMint,
}
