#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;
pub mod types;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub use helpers::*;
pub use instructions::*;
pub use state::*;
pub use types::*;

declare_id!("jkhaCtRjHFmw1E6fZVL3MdR2dBjka1Rh1cEufFE5mGF");

#[program]
pub mod envelope {
    use super::*;

    pub fn create_line(
        ctx: Context<CreateLine>,
        open_window: u64,
        bond_bps: u16,
        min_bond: u64,
        stale_slots: u64,
        seal_until_slot: u64,
        ordered_open: bool,
    ) -> Result<()> {
        instructions::create_line::handler(
            ctx,
            open_window,
            bond_bps,
            min_bond,
            stale_slots,
            seal_until_slot,
            ordered_open,
        )
    }

    pub fn seal(ctx: Context<Seal>, fingerprint: [u8; 32], cap: u64) -> Result<()> {
        instructions::seal::handler(ctx, fingerprint, cap)
    }

    pub fn open<'info>(
        ctx: Context<'_, '_, 'info, 'info, Open<'info>>,
        content: Vec<u8>,
        secret: [u8; 32],
    ) -> Result<()> {
        instructions::open::handler(ctx, content, secret)
    }

    pub fn execute<'info>(ctx: Context<'_, '_, 'info, 'info, Execute<'info>>) -> Result<()> {
        instructions::execute::handler(ctx)
    }
}
