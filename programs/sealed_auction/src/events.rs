use anchor_lang::prelude::*;

#[event]
pub struct LotListed {
    pub lot: Pubkey,
    pub seller: Pubkey,
    pub lot_mint: Pubkey,
    pub lot_amount: u64,
    pub reserve: u64,
    pub close_slot: u64,
    pub reveal_window: u64,
    pub line: Pubkey,
}

#[event]
pub struct BidExecuted {
    pub lot: Pubkey,
    pub place: u64,
    pub bidder: Pubkey,
    pub amount: u64,
    pub best: bool,
    pub reason: u8,
}

#[event]
pub struct LotSettled {
    pub lot: Pubkey,
    pub winner: Pubkey,
    pub price: u64,
    pub place: u64,
    pub slot: u64,
}

#[event]
pub struct LotNoBid {
    pub lot: Pubkey,
    pub slot: u64,
}
