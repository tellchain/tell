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
pub(crate) use helpers::*;
pub use instructions::*;
pub use state::*;
pub use types::*;

declare_id!("CWvRXgP4d9QGZFEt1DBEBnpECtUEW5F1hRD1QKbZ5YMH");

#[program]
pub mod sealed_auction {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn list_lot(
        ctx: Context<ListLot>,
        lot_id: u64,
        lot_amount: u64,
        reserve: u64,
        close_slot: u64,
        reveal_window: u64,
        bond_bps: u16,
        min_bond: u64,
        stale_slots: u64,
    ) -> Result<()> {
        instructions::list_lot::handler(
            ctx,
            lot_id,
            lot_amount,
            reserve,
            close_slot,
            reveal_window,
            bond_bps,
            min_bond,
            stale_slots,
        )
    }

    pub fn on_envelope<'info>(
        ctx: Context<'_, '_, 'info, 'info, OnEnvelope<'info>>,
        owner: Pubkey,
        place: u64,
        cap: u64,
        payload: Vec<u8>,
    ) -> Result<()> {
        instructions::on_envelope::handler(ctx, owner, place, cap, payload)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }
}
