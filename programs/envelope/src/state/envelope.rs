use crate::*;
use anchor_lang::prelude::*;

#[account]
pub struct Envelope {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub fingerprint: [u8; 32],
    pub cap: u64,
    pub bond: u64,
    pub bond_source: Pubkey,
    pub sealed_slot: u64,
    pub open_deadline: u64,
    pub opened_slot: u64,
    pub executed_slot: u64,
    pub state: u8,
    pub consumer_ok: bool,
    pub bump: u8,
    pub ata_deposit: u64,
    pub reserved: [u8; 32],
    pub content: Vec<u8>,
}

impl Envelope {
    pub const SPACE: usize =
        8 + 32 + 8 + 32 + 32 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 32 + 4 + MAX_CONTENT;
}
