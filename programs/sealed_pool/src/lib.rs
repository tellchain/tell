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
}
