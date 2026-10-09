import { FLAG, HIDDEN, type Game } from './game';
import { neighbourTable } from './grid';
import { firstDeduction } from './tatham/mines';

export interface Hint {
  text: string;
  /** Cells to look at: the numbers (and flags) the reasoning uses. */
  sources: number[];
  /** Cells the reasoning shows are safe, mines, or wrongly flagged. */
  safe: number[];
  mines: number[];
  wrong: number[];
}

interface Constraint {
  at: number;
  value: number;
  /** Mines still needed: the number minus flags around it. */
  need: number;
  /** Hidden, unflagged neighbours. */
  cells: number[];
}

const hint = (text: string, parts: Partial<Omit<Hint, 'text'>> = {}): Hint => ({
  text,
  sources: [],
  safe: [],
  mines: [],
  wrong: [],
  ...parts,
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const mineCount = (n: number) => plural(n, 'mine');
const cellCount = (n: number) => plural(n, 'cell');
const they = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "other cell" / "other 3 cells" */
const others = (n: number, word = 'other') => (n === 1 ? `${word} cell` : `${word} ${n} cells`);

/**
 * Finds the next logical step from what the player can see, preferring the
 * simplest explanation: a wrong flag, a single number, two overlapping
 * numbers, the total mine count, and finally the full solver.
 */
export function findHint(g: Game): Hint {
  if (g.status === 'ready') return hint('Tap anywhere to start: the first tap is always safe and opens an area.');
  if (g.status === 'lost') return hint('You hit a mine. Undo to take that move back.', { wrong: g.hit >= 0 ? [g.hit] : [] });
  if (g.status === 'won' || !g.mines) return hint('The board is cleared.');

  const { w, h, cells, mines } = g;
  const nb = neighbourTable(w, h);

  // Every deduction below trusts the flags, so a wrong one comes first.
  const wrong = cells.findIndex((c, i) => c === FLAG && !mines[i]);
  if (wrong >= 0) return hint('There’s no mine under this flag. Remove it, then ask again.', { wrong: [wrong] });

  const cons: Constraint[] = [];
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v <= 0) continue;
    const hidden: number[] = [];
    let flags = 0;
    for (const n of nb[i]) {
      if (cells[n] === FLAG) flags++;
      else if (cells[n] === HIDDEN) hidden.push(n);
    }
    if (hidden.length) cons.push({ at: i, value: v, need: v - flags, cells: hidden });
  }

  return single(cons) ?? pair(cons) ?? global(g, cons) ?? solver(g, nb);
}

function single(cons: Constraint[]): Hint | null {
  for (const c of cons) {
    const n = c.cells.length;
    if (c.need === 0) {
      return hint(
        `This ${c.value} already has ${plural(c.value, 'flag')} next to it, so its other hidden ${they(n, 'neighbour is', 'neighbours are')} safe.`,
        { sources: [c.at], safe: c.cells },
      );
    }
    if (c.need === n) {
      const text =
        c.need === c.value
          ? `This ${c.value} has exactly ${plural(n, 'hidden neighbour')}, so ${they(n, 'it’s a mine', 'they’re all mines')}.`
          : `This ${c.value} still needs ${mineCount(c.need)} and has exactly ${plural(n, 'hidden neighbour')} left, so ${they(n, 'it’s a mine', 'they’re all mines')}.`;
      return hint(text, { sources: [c.at], mines: c.cells });
    }
  }
  return null;
}

function pair(cons: Constraint[]): Hint | null {
  const byCell = new Map<number, Constraint[]>();
  for (const c of cons) for (const cell of c.cells) byCell.set(cell, [...(byCell.get(cell) ?? []), c]);

  for (const a of cons) {
    const partners = new Set<Constraint>();
    for (const cell of a.cells) for (const b of byCell.get(cell)!) if (b !== a) partners.add(b);
    for (const b of partners) {
      const aOnly = a.cells.filter((x) => !b.cells.includes(x));
      const bOnly = b.cells.filter((x) => !a.cells.includes(x));
      // At most b.need mines fit in the shared cells, so a's own cells hold at least a.need - b.need.
      if (aOnly.length !== a.need - b.need || (!aOnly.length && !bOnly.length)) continue;
      const shared = a.cells.length - aOnly.length;
      const sources = [a.at, b.at];
      if (!aOnly.length) {
        return hint(
          `This ${a.value} needs ${mineCount(a.need)}, all in the ${cellCount(shared)} it shares with the ${b.value}. That accounts for the ${b.value}’s ${mineCount(b.need)}, so its ${others(bOnly.length)} ${they(bOnly.length, 'is', 'are')} safe.`,
          { sources, safe: bOnly },
        );
      }
      const text =
        `This ${a.value} needs ${mineCount(a.need)}, but at most ${b.need} can be in the ${cellCount(shared)} it shares with the ${b.value}. ` +
        `So its ${others(aOnly.length)} must ${they(aOnly.length, 'be a mine', 'all be mines')}` +
        (bOnly.length ? `, and the ${b.value}’s ${others(bOnly.length)} ${they(bOnly.length, 'is', 'are')} safe.` : '.');
      return hint(text, { sources, mines: aOnly, safe: bOnly });
    }
  }
  return null;
}

function global(g: Game, cons: Constraint[]): Hint | null {
  const hidden: number[] = [];
  let flags = 0;
  g.cells.forEach((c, i) => {
    if (c === HIDDEN) hidden.push(i);
    else if (c === FLAG) flags++;
  });
  const left = g.n - flags;
  if (left === 0) return hint('Every mine is flagged, so all the remaining hidden cells are safe.', { safe: hidden });
  if (left === hidden.length) {
    return hint(`${mineCount(left)} left and exactly ${cellCount(hidden.length)} hidden, so they’re all mines.`, { mines: hidden });
  }

  // A family of non-overlapping numbers that accounts for every remaining
  // mine (or for all but as many as there are cells outside it).
  const unique = [...new Map(cons.map((c) => [c.cells.join(','), c])).values()];
  let budget = 200_000;
  let best: { family: Constraint[]; outside: number[]; mine: boolean } | null = null;
  const used = new Set<number>();
  const family: Constraint[] = [];
  const search = (start: number, need: number, size: number) => {
    if (best || budget-- <= 0) return;
    if (family.length) {
      const outsideCount = hidden.length - size;
      if (outsideCount > 0 && (left - need === 0 || left - need === outsideCount)) {
        best = { family: family.slice(), outside: hidden.filter((c) => !used.has(c)), mine: left - need !== 0 };
        return;
      }
    }
    for (let k = start; k < unique.length; k++) {
      const c = unique[k];
      if (need + c.need > left || c.cells.some((x) => used.has(x))) continue;
      family.push(c);
      c.cells.forEach((x) => used.add(x));
      search(k + 1, need + c.need, size + c.cells.length);
      c.cells.forEach((x) => used.delete(x));
      family.pop();
    }
  };
  search(0, 0, 0);
  if (!best) return null;
  const { family: fam, outside, mine } = best as { family: Constraint[]; outside: number[]; mine: boolean };
  const need = fam.reduce((s, c) => s + c.need, 0);
  const text =
    `${mineCount(left)} left. ${fam.length === 1 ? `This ${fam[0].value} needs` : `These ${fam.length} numbers need`} ${mineCount(need)} ` +
    `${fam.length === 1 ? 'among its hidden neighbours' : 'between them, in cells that don’t overlap'}, ` +
    (mine
      ? `leaving ${mineCount(left - need)} for the ${others(outside.length)}: ${they(outside.length, 'it’s a mine', 'they’re all mines')}.`
      : `so every other hidden cell is safe.`);
  return hint(text, { sources: fam.map((c) => c.at), [mine ? 'mines' : 'safe']: outside });
}

function solver(g: Game, nb: Int32Array[]): Hint {
  const board = Int8Array.from(g.cells, (c) => (c === HIDDEN ? -2 : c === FLAG ? -1 : c));
  const found = firstDeduction(g.w, g.h, g.n, board, g.mines!);
  if (!found) {
    return hint(
      g.noGuess ? 'No logical step found from here.' : 'There’s no safe deduction here: this board wasn’t generated to avoid guessing, so you’ll have to guess.',
    );
  }
  // Point at the numbers in the neighbourhood the deduction draws on.
  const near = new Set<number>();
  for (const a of nb[found.tile]) for (const b of [a, ...nb[a]]) if (g.cells[b] > 0) near.add(b);
  return hint(
    `This one takes a longer chain of reasoning: combining the numbers around here shows this cell ${found.mine ? 'is a mine' : 'is safe'}.`,
    { sources: [...near], [found.mine ? 'mines' : 'safe']: [found.tile] },
  );
}
