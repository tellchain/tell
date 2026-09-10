#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub use instructions::*;
pub use math::*;
pub use state::*;

declare_id!("HxzVrsgrfeYXmdjT5cxsZBaj6z4WdQMqQjTp8Z7EN957");

#[program]
pub mod open_pool {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, registrar: Pubkey) -> Result<()> {
        instructions::init_config::handler(ctx, registrar)
    }

    pub fn set_registrar(ctx: Context<SetRegistrar>, registrar: Pubkey) -> Result<()> {
        instructions::set_registrar::handler(ctx, registrar)
    }

    pub fn create_pool(
        ctx: Context<CreatePool>,
        base_amount: u64,
        quote_amount: u64,
        opener: Pubkey,
        opener_label: [u8; 32],
    ) -> Result<()> {
        instructions::create_pool::handler(ctx, base_amount, quote_amount, opener, opener_label)
    }

    pub fn swap(ctx: Context<Swap>, side: u8, amount_in: u64, min_out: u64) -> Result<()> {
        instructions::swap::handler(ctx, side, amount_in, min_out)
    }
}
