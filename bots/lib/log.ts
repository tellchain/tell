export function logger(role: string) {
  const label = `tell:${role}`;
  const out = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), w: label, level, msg, ...extra }));
  return {
    info: (m: string, x?: Record<string, unknown>) => out("info", m, x),
    warn: (m: string, x?: Record<string, unknown>) => out("warn", m, x),
    error: (m: string, x?: Record<string, unknown>) => out("error", m, x),
  };
}
export type Log = ReturnType<typeof logger>;
