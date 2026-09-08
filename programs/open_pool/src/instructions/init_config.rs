use crate::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>, registrar: Pubkey) -> Result<()> {
    ctx.accounts.config.registrar = registrar;
    ctx.accounts.config.bump = ctx.bumps.config;
    Ok(())
}
