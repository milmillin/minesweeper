import { neighbourTable } from './grid';
import { solve, UNKNOWN } from './solver';

export interface GenerateOptions {
  noGuess: boolean;
  rng?: () => number;
  /** Give up on no-guess generation after this many ms and return a random board. */
  timeBudget?: number;
}

/** Largest mine count that still leaves the 3×3 around the first click clear. */
export function maxMines(w: number, h: number): number {
  return Math.max(1, w * h - 9);
}

/**
 * Lays mines for a board whose first click is `start`. The first click and its
 * neighbours are always clear, so the game opens on a zero. With `noGuess`,
 * the board is perturbed until it can be cleared by logic alone.
 */
export function generate(w: number, h: number, n: number, start: number, opts: GenerateOptions): Uint8Array {
  const { noGuess, rng = Math.random, timeBudget = 2000 } = opts;
  const N = w * h;
  const nb = neighbourTable(w, h);
  const excluded = new Set<number>([start]);
  if (N - 9 >= n) for (const c of nb[start]) excluded.add(c);
  const candidates: number[] = [];
  for (let i = 0; i < N; i++) if (!excluded.has(i)) candidates.push(i);
  n = Math.min(n, candidates.length);

  const place = () => {
    const mines = new Uint8Array(N);
    const pool = candidates.slice();
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
      mines[pool[k]] = 1;
    }
    return mines;
  };

  let mines = place();
  if (!noGuess) return mines;

  const deadline = performance.now() + timeBudget;
  while (performance.now() < deadline) {
    for (let iter = 0; iter < N; iter++) {
      const { solved, known } = solve(w, h, mines, start);
      if (solved) return mines;

      // Stuck. Move mines off the frontier (unknown cells touching revealed
      // numbers) into the unexplored interior, then try again.
      const frontierMines: number[] = [];
      const interiorSafe: number[] = [];
      for (let i = 0; i < N; i++) {
        if (known[i] !== UNKNOWN || excluded.has(i)) continue;
        let frontier = false;
        for (const c of nb[i]) if (known[c] === 0) { frontier = true; break; }
        if (frontier) { if (mines[i]) frontierMines.push(i); }
        else if (!mines[i]) interiorSafe.push(i);
      }
      if (!frontierMines.length || !interiorSafe.length) break;
      const moves = Math.min(frontierMines.length, interiorSafe.length, 1 + Math.floor(rng() * 3));
      for (let k = 0; k < moves; k++) {
        const fi = Math.floor(rng() * frontierMines.length);
        const si = Math.floor(rng() * interiorSafe.length);
        mines[frontierMines[fi]] = 0;
        mines[interiorSafe[si]] = 1;
        frontierMines.splice(fi, 1);
        interiorSafe.splice(si, 1);
      }
    }
    mines = place();
  }
  return mines;
}
