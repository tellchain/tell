#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod math;
pub mod state;
pub mod types;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub(crate) use helpers::*;
pub use instructions::*;
pub use math::*;
pub use state::*;
pub use types::*;

declare_id!("D1nuiLpfLrhm5qbMaLUdb2cLaAYWgCPDEXWaw2KE4Un7");

#[program]
pub mod sealed_pool {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, registrar: Pubkey) -> Result<()> {
        instructions::init_config::handler(ctx, registrar)
    }

    pub fn set_registrar(ctx: Context<SetRegistrar>, registrar: Pubkey) -> Result<()> {
        instructions::set_registrar::handler(ctx, registrar)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_pool(
        ctx: Context<CreatePool>,
        open_window: u64,
        bond_bps: u16,
        min_bond: u64,
        stale_slots: u64,
        base_amount: u64,
        quote_amount: u64,
        opener: Pubkey,
        opener_label: [u8; 32],
        ordered_open: bool,
    ) -> Result<()> {
        instructions::create_pool::handler(
            ctx,
            open_window,
            bond_bps,
            min_bond,
            stale_slots,
            base_amount,
            quote_amount,
            opener,
            opener_label,
            ordered_open,
        )
    }
}
