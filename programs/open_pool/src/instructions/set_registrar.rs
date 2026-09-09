use crate::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetRegistrar<'info> {
    pub registrar: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = registrar)]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<SetRegistrar>, registrar: Pubkey) -> Result<()> {
    ctx.accounts.config.registrar = registrar;
    Ok(())
}
