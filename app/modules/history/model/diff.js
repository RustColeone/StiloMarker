// Comparing two versions of a text, line by line (longest common subsequence;
// a cheaper prefix/suffix comparison for very large texts). Pure.
export function diffLines(oldText, newText) {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 1_600_000) return prefixSuffixDiff(a, b);

  const dp = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i], oldLine: i + 1, newLine: j + 1 }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null }); i += 1; }
    else { ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 }); j += 1; }
  }
  while (i < n) { ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null }); i += 1; }
  while (j < m) { ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 }); j += 1; }
  return ops;
}

function prefixSuffixDiff(a, b) {
  const n = a.length;
  const m = b.length;
  let p = 0;
  while (p < n && p < m && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s += 1;
  const ops = [];
  for (let i = 0; i < p; i += 1) ops.push({ type: "same", text: a[i], oldLine: i + 1, newLine: i + 1 });
  for (let i = p; i < n - s; i += 1) ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
  for (let j = p; j < m - s; j += 1) ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
  for (let k = 0; k < s; k += 1) ops.push({ type: "same", text: a[n - s + k], oldLine: n - s + k + 1, newLine: m - s + k + 1 });
  return ops;
}
