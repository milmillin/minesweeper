import { countAdjacent, neighbourTable } from './grid';

export const UNKNOWN = -1;
export const SAFE = 0;
export const MINE = 1;

export interface SolveResult {
  solved: boolean;
  /** Per cell: UNKNOWN, SAFE (revealed) or MINE (deduced). */
  known: Int8Array;
}

interface Constraint {
  cells: number[];
  count: number;
}

/**
 * Plays the board from `start` using only logical deductions — never guessing —
 * and reports whether every safe cell could be revealed.
 *
 * Rules: single-number (all safe / all mines), pairwise overlap between
 * neighbouring numbers, and the global remaining-mine count.
 */
export function solve(w: number, h: number, mines: ArrayLike<number>, start: number): SolveResult {
  const N = w * h;
  const nb = neighbourTable(w, h);
  const num = countAdjacent(w, h, mines);
  const known = new Int8Array(N).fill(UNKNOWN);
  let total = 0;
  for (let i = 0; i < N; i++) total += mines[i];
  let unknownCount = N;
  let minesLeft = total;
  let safeLeft = N - total;
  const stack: number[] = [];

  const reveal = (i: number) => {
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      if (known[c] !== UNKNOWN) continue;
      if (mines[c]) throw new Error('solver revealed a mine');
      known[c] = SAFE;
      unknownCount--;
      safeLeft--;
      if (num[c] === 0) for (const n of nb[c]) if (known[n] === UNKNOWN) stack.push(n);
    }
  };
  const markMine = (i: number) => {
    if (known[i] !== UNKNOWN) return;
    known[i] = MINE;
    unknownCount--;
    minesLeft--;
  };

  if (mines[start]) return { solved: false, known };
  reveal(start);

  while (safeLeft > 0) {
    let progress = false;
    const cons: Constraint[] = [];
    const byCell = new Map<number, number[]>();

    for (let c = 0; c < N; c++) {
      if (known[c] !== SAFE || num[c] === 0) continue;
      const cells: number[] = [];
      let flagged = 0;
      for (const n of nb[c]) {
        if (known[n] === UNKNOWN) cells.push(n);
        else if (known[n] === MINE) flagged++;
      }
      if (!cells.length) continue;
      const count = num[c] - flagged;
      if (count === 0) {
        cells.forEach(reveal);
        progress = true;
      } else if (count === cells.length) {
        cells.forEach(markMine);
        progress = true;
      } else if (!progress) {
        const idx = cons.length;
        cons.push({ cells, count });
        for (const cell of cells) {
          const list = byCell.get(cell);
          if (list) list.push(idx);
          else byCell.set(cell, [idx]);
        }
      }
    }
    if (progress) continue;

    // Pairwise overlap: for numbers A, B sharing unknown cells,
    //   mines(B\A) >= B.count - A.count          → if equals |B\A|, B\A are mines and A\B safe
    //   mines(B\A) <= B.count - A.count + |A\B|  → if 0, B\A are safe
    pairs: for (let ai = 0; ai < cons.length; ai++) {
      const a = cons[ai];
      const partners = new Set<number>();
      for (const cell of a.cells) for (const bi of byCell.get(cell)!) if (bi !== ai) partners.add(bi);
      for (const bi of partners) {
        const b = cons[bi];
        const aOnly = a.cells.filter((c) => !b.cells.includes(c));
        const bOnly = b.cells.filter((c) => !a.cells.includes(c));
        if (!bOnly.length) continue;
        const diff = b.count - a.count;
        if (diff === bOnly.length) {
          bOnly.forEach(markMine);
          aOnly.forEach(reveal);
          progress = true;
          break pairs;
        }
        if (diff + aOnly.length === 0) {
          bOnly.forEach(reveal);
          progress = true;
          break pairs;
        }
      }
    }
    if (progress) continue;

    if (minesLeft === 0 || minesLeft === unknownCount) {
      for (let i = 0; i < N; i++) {
        if (known[i] !== UNKNOWN) continue;
        if (minesLeft === 0) reveal(i);
        else markMine(i);
      }
      continue;
    }
    break;
  }

  return { solved: safeLeft === 0, known };
}
