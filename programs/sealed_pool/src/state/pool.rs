use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub lp_mint: Pubkey,
    pub line: Pubkey,
    pub fee_bps: u16,
    pub opener: Pubkey,
    pub opener_label: [u8; 32],
    pub created_slot: u64,
    pub swaps: u64,
    pub lp_locked: u64,
    pub reserve_base: u64,
    pub reserve_quote: u64,
    pub bump: u8,
    pub reserved: [u8; 64],
}
