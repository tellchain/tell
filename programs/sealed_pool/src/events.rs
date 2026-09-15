use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub line: Pubkey,
    pub opener: Pubkey,
    pub opener_label: [u8; 32],
    pub base_amount: u64,
    pub quote_amount: u64,
    pub slot: u64,
}

#[event]
pub struct Swapped {
    pub pool: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub side: u8,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub filled: bool,
    pub reason: u8,
    pub base_reserve: u64,
    pub quote_reserve: u64,
}

#[event]
pub struct LiquidityAdded {
    pub pool: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub base: u64,
    pub quote: u64,
    pub lp: u64,
    pub filled: bool,
    pub reason: u8,
}

#[event]
pub struct LiquidityRemoved {
    pub pool: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub base: u64,
    pub quote: u64,
    pub lp: u64,
    pub filled: bool,
    pub reason: u8,
}
