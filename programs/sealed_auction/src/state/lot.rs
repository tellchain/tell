use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Lot {
    pub seller: Pubkey,
    pub lot_id: u64,
    pub lot_mint: Pubkey,
    pub lot_amount: u64,
    pub lot_vault: Pubkey,
    pub quote_mint: Pubkey,
    pub bid_vault: Pubkey,
    pub reserve: u64,
    pub close_slot: u64,
    pub reveal_window: u64,
    pub line: Pubkey,
    pub best_bid: u64,
    pub best_bidder: Pubkey,
    pub best_place: u64,
    pub bids_executed: u64,
    pub state: u8,
    pub bump: u8,
    pub reserved: [u8; 64],
}
