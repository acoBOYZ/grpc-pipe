// debug.ts
export function dlog(ns: string, ...args: any[]) {
  const dbg = process.env.DEBUG;
  if (!dbg) return;
  // allow comma/space separated, and wildcard "pipe:*"
  const tokens = dbg.split(/[\s,]+/).filter(Boolean);
  if (tokens.includes(ns) || tokens.includes('pipe:*')) {
    // eslint-disable-next-line no-console
    console.log(`[${ns}]`, ...args);
  }
}