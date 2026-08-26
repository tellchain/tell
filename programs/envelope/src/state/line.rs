use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Line {
    pub market: Pubkey,
    pub consumer: Pubkey,
    pub bond_mint: Pubkey,
    pub bond_vault: Pubkey,
    pub bond_bps: u16,
    pub min_bond: u64,
    pub stale_slots: u64,
    pub open_window: u64,
    pub seal_until_slot: u64,
    pub ordered_open: bool,
    pub next_place: u64,
    pub next_execute: u64,
    pub sealed: u64,
    pub opened: u64,
    pub executed: u64,
    pub skipped: u64,
    pub bonds_burned: u64,
    pub last_open_deadline: u64,
    pub cursor_moved_slot: u64,
    pub bump: u8,
    pub reserved: [u8; 64],
}
