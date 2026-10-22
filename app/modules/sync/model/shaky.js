// Whether a shared session's connection is shaky: it dropped this often in a
// short while. A PIN session that drops sends nothing typed in its last
// moment (docs/ISSUES.md, O8, accepted), so the person is told when drops
// come close together. Pure: the drops so far and the time in, the judgement
// out.
export const SHAKY_DROPS = 2;               // this many drops...
export const SHAKY_WITHIN = 10 * 60 * 1000; // ...within this long is shaky
export const WARN_EVERY = 10 * 60 * 1000;   // and it is said at most this often

// state: { drops: [times], warnedAt } -> { drops, warnedAt, warn }
export function noteDrop(state, now) {
  const drops = [...(state?.drops ?? []), now].filter((time) => now - time <= SHAKY_WITHIN);
  const warnedAt = state?.warnedAt ?? -Infinity;
  const warn = drops.length >= SHAKY_DROPS && now - warnedAt >= WARN_EVERY;
  return { drops, warnedAt: warn ? now : warnedAt, warn };
}
