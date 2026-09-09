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
}
