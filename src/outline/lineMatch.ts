/**
 * Match lines of an edited outline to lines of the previous version, so items keep their IDs
 * when other lines are inserted, deleted, re-indented or edited in place.
 */

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.toLowerCase();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient on character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

const MAX_DP_CELLS = 4_000_000;

/** Longest common subsequence pairs between a[lo1..hi1) and b[lo2..hi2). */
function lcsPairs(a: string[], b: string[], lo1: number, hi1: number, lo2: number, hi2: number): [number, number][] {
  const n = hi1 - lo1;
  const m = hi2 - lo2;
  if (!n || !m || n * m > MAX_DP_CELLS) return [];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[lo1 + i] === b[lo2 + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[lo1 + i] === b[lo2 + j]) {
      pairs.push([lo1 + i, lo2 + j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Returns, for each new line, the index of the old line it corresponds to (or undefined).
 * Blank lines are never matched. Order of matched lines is preserved.
 */
export function matchLines(oldText: string[], newText: string[]): (number | undefined)[] {
  const a = oldText.map(norm);
  const b = newText.map(norm);
  const result: (number | undefined)[] = new Array(b.length).fill(undefined);

  // Common prefix and suffix first: most edits are local, which keeps the DP small.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) {
    result[pre] = pre;
    pre++;
  }
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
    result[b.length - 1 - suf] = a.length - 1 - suf;
    suf++;
  }

  const anchors = lcsPairs(a, b, pre, a.length - suf, pre, b.length - suf);
  for (const [i, j] of anchors) result[j] = i;

  // Gaps between anchors: pair in-place edits by similarity, keeping order.
  const bounds: [number, number][] = [[pre - 1, pre - 1], ...anchors, [a.length - suf, b.length - suf]];
  const usedOld = new Set<number>(result.filter((x): x is number => x !== undefined));
  for (let k = 0; k < bounds.length - 1; k++) {
    const [oi0, nj0] = bounds[k];
    const [oi1, nj1] = bounds[k + 1];
    const olds: number[] = [];
    const news: number[] = [];
    for (let i = oi0 + 1; i < oi1; i++) if (a[i]) olds.push(i);
    for (let j = nj0 + 1; j < nj1; j++) if (b[j]) news.push(j);
    if (!olds.length || !news.length) continue;
    if (olds.length === 1 && news.length === 1) {
      result[news[0]] = olds[0];
      usedOld.add(olds[0]);
      continue;
    }
    let from = 0;
    for (const j of news) {
      let best = -1;
      let bestScore = 0.5;
      for (let x = from; x < olds.length; x++) {
        const s = similarity(a[olds[x]], b[j]);
        if (s > bestScore) {
          bestScore = s;
          best = x;
        }
      }
      if (best >= 0) {
        result[j] = olds[best];
        usedOld.add(olds[best]);
        from = best + 1;
      }
    }
  }

  // Lines moved elsewhere (cut and paste): exact content match among the leftovers.
  const leftovers = new Map<string, number[]>();
  a.forEach((line, i) => {
    if (line && !usedOld.has(i)) leftovers.set(line, [...(leftovers.get(line) ?? []), i]);
  });
  b.forEach((line, j) => {
    if (result[j] !== undefined || !line) return;
    const pool = leftovers.get(line);
    if (pool?.length) result[j] = pool.shift();
  });

  b.forEach((line, j) => {
    if (!line) result[j] = undefined;
  });
  return result;
}
