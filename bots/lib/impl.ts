import type { Chain } from "./chain.js";

let cached: Chain | null = null;
export async function getChain(): Promise<Chain> {
  if (cached) return cached;
  const mod = process.env.TELL_CHAIN_ADAPTER ?? "./adapter.js";
  try {
    cached = (await import(mod)).default as Chain;
    return cached;
  } catch (e) {
    throw new Error(`chain adapter not available yet (${mod}): waits on program/INTERFACE.md and the client package - ${String(e)}`);
  }
}
