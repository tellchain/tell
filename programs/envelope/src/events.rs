use anchor_lang::prelude::*;

#[event]
pub struct LineCreated {
    pub line: Pubkey,
    pub market: Pubkey,
    pub consumer: Pubkey,
    pub bond_mint: Pubkey,
    pub bond_bps: u16,
    pub min_bond: u64,
    pub stale_slots: u64,
    pub open_window: u64,
    pub seal_until_slot: u64,
    pub ordered_open: bool,
}

#[event]
pub struct Sealed {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub fingerprint: [u8; 32],
    pub cap: u64,
    pub bond: u64,
    pub sealed_slot: u64,
    pub open_deadline: u64,
}

#[event]
pub struct Opened {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub opened_slot: u64,
    pub content: Vec<u8>,
}

#[event]
pub struct Executed {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub executed_slot: u64,
    pub filled: bool,
    pub reason: u8,
    pub bond_returned: u64,
}

#[event]
pub struct Skipped {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub executed_slot: u64,
    pub bond_burned: u64,
}

#[event]
pub struct Voided {
    pub line: Pubkey,
    pub place: u64,
    pub owner: Pubkey,
    pub slot: u64,
    pub bond_burned: u64,
}
