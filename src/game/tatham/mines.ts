/*
 * Port of the mine-layout generator from mines.c in Simon Tatham's Portable
 * Puzzle Collection (https://www.chiark.greenend.org.uk/~sgtatham/puzzles/),
 * square grid only. Given the same game ID and first click, it produces the
 * same board as the original, including its quirks:
 *
 *  - set ordering before a perturbation reproduces the "backwards
 *    compatibility" sort, with its negative shift evaluated as wasm does;
 *  - `qsort` is musl's smoothsort, as linked into the WebAssembly build;
 *  - mineperturb's partial-fill branch reuses its loop counter as the output
 *    index (see `UNINIT` below).
 *
 * Tiles are numbered y*w + x. Board values: 0..8 open, -1 known mine, -2 unknown.
 */

import { neighbourTable } from '../grid';
import { qsort } from './qsort';
import { ascii, randomBits, randomNew, randomStateDecode, randomStateEncode, randomUpto, Sha1, type RandomState } from './random';

const MAX_NEIGHBOURS = 16;

// ---------------------------------------------------------------------------
// Sets and to-do list

interface MSet {
  tile: number[];
  n: number;
  mines: number;
  todo: boolean;
  todoPrev: MSet | null;
  todoNext: MSet | null;
  allPrev: MSet | null;
  allNext: MSet | null;
}

interface SetStore {
  n: number;
  allHead: MSet | null;
  allTail: MSet | null;
  todoHead: MSet | null;
  todoTail: MSet | null;
}

const setNew = (): MSet => ({ tile: [], n: 0, mines: 0, todo: false, todoPrev: null, todoNext: null, allPrev: null, allNext: null });

function setDup(s: MSet): MSet {
  const r = setNew();
  r.n = s.n;
  r.mines = s.mines;
  r.tile = s.tile.slice(0, s.n);
  return r;
}

function setRemoveTile(s: MSet, tile: number) {
  for (let i = 0; i < s.n; i++) {
    if (s.tile[i] === tile) {
      for (let j = i; j < s.n - 1; j++) s.tile[j] = s.tile[j + 1];
      s.n--;
      return;
    }
  }
  throw new Error('Tried to remove non-present tile from set');
}

function setWings(a: MSet, b: MSet, w1: MSet, w2: MSet) {
  let i = 0, j = 0;
  w1.n = 0;
  w2.n = 0;
  while (i < a.n && j < b.n) {
    if (a.tile[i] < b.tile[j]) w1.tile[w1.n++] = a.tile[i++];
    else if (a.tile[i] > b.tile[j]) w2.tile[w2.n++] = b.tile[j++];
    else { i++; j++; }
  }
  while (i < a.n) w1.tile[w1.n++] = a.tile[i++];
  while (j < b.n) w2.tile[w2.n++] = b.tile[j++];
}

function setOverlap(a: MSet, b: MSet): boolean {
  let i = 0, j = 0;
  while (i < a.n && j < b.n) {
    if (a.tile[i] === b.tile[j]) return true;
    if (a.tile[i] < b.tile[j]) i++;
    else j++;
  }
  return false;
}

function setContains(s: MSet, tile: number): boolean {
  for (let i = 0; i < s.n; i++) if (s.tile[i] === tile) return true;
  return false;
}

function ssAddTodo(ss: SetStore, s: MSet) {
  if (s.todo) return;
  s.todoPrev = ss.todoTail;
  if (s.todoPrev) s.todoPrev.todoNext = s;
  else ss.todoHead = s;
  ss.todoTail = s;
  s.todoNext = null;
  s.todo = true;
}

function sameTiles(a: MSet, b: MSet): boolean {
  if (a.n !== b.n) return false;
  for (let i = 0; i < a.n; i++) if (a.tile[i] !== b.tile[i]) return false;
  return true;
}

function ssAdd(ss: SetStore, s: MSet) {
  const sorted = s.tile.slice(0, s.n).sort((x, y) => x - y);
  s.tile = sorted;
  for (let f = ss.allHead; f; f = f.allNext) if (sameTiles(f, s)) return;
  s.allNext = null;
  s.allPrev = ss.allTail;
  if (s.allPrev) s.allPrev.allNext = s;
  ss.allTail = s;
  if (!ss.allHead) ss.allHead = s;
  ss.n++;
  ssAddTodo(ss, s);
}

function ssRemove(ss: SetStore, s: MSet) {
  let next = s.todoNext, prev = s.todoPrev;
  if (prev) prev.todoNext = next;
  else if (s === ss.todoHead) ss.todoHead = next;
  if (next) next.todoPrev = prev;
  else if (s === ss.todoTail) ss.todoTail = prev;
  s.todo = false;

  const an = s.allNext, ap = s.allPrev;
  if (ap) ap.allNext = an;
  else if (s === ss.allHead) ss.allHead = an;
  if (an) an.allPrev = ap;
  else if (s === ss.allTail) ss.allTail = ap;
  ss.n--;
}

function ssCheckUniq(ss: SetStore, s: MSet) {
  for (let f = ss.allHead; f; f = f.allNext) {
    if (f === s) continue;
    if (sameTiles(f, s)) {
      ssRemove(ss, s);
      return;
    }
  }
  if (!s.todo) ssAddTodo(ss, s);
}

function ssContains(ss: SetStore, tile: number): MSet[] {
  const ret: MSet[] = [];
  for (let f = ss.allHead; f; f = f.allNext) if (setContains(f, tile)) ret.push(f);
  return ret;
}

function ssOverlap(ss: SetStore, s: MSet): MSet[] {
  const ret: MSet[] = [];
  for (let f = ss.allHead; f; f = f.allNext) if (setOverlap(s, f)) ret.push(f);
  return ret;
}

function ssTodo(ss: SetStore): MSet | null {
  const ret = ss.todoHead;
  if (!ret) return null;
  ss.todoHead = ret.todoNext;
  if (ss.todoHead) ss.todoHead.todoPrev = null;
  else ss.todoTail = null;
  ret.todoNext = ret.todoPrev = null;
  ret.todo = false;
  return ret;
}

interface SquareTodo {
  next: Int32Array;
  head: number;
  tail: number;
}

function stdAdd(std: SquareTodo, i: number) {
  if (std.tail >= 0) std.next[std.tail] = i;
  else std.head = i;
  std.tail = i;
  std.next[i] = -1;
}

// ---------------------------------------------------------------------------
// Solver

interface Grid {
  w: number;
  h: number;
  ntiles: number;
  nb: Int32Array[];
}

interface Perturbation {
  tile: number;
  delta: number;
}

type OpenCb = (tile: number) => number;
type PerturbCb = (board: Int8Array, s: MSet | null) => Perturbation[] | null;

type KnownCb = (tile: number, mine: boolean) => void;

function knownSquares(std: SquareTodo, board: Int8Array, open: OpenCb, onKnown: KnownCb | undefined, s: MSet, mine: boolean) {
  for (let i = 0; i < s.n; i++) {
    const tile = s.tile[i];
    if (board[tile] === -2) {
      onKnown?.(tile, mine);
      if (mine) board[tile] = -1;
      else {
        board[tile] = open(tile);
        if (board[tile] === -1) throw new Error('solver opened a mine');
      }
      stdAdd(std, tile);
    }
  }
}

const single = (tile: number): MSet => ({ ...setNew(), tile: [tile], n: 1 });

/** Value of `short mask` after `mask <<= shift` for a negative shift, as the wasm build computes it. */
const shortShl = (mask: number, shift: number) => ((mask << (shift & 31)) << 16) >> 16;

/**
 * minesolve(). Returns -1 if deduction stalled, otherwise the number of
 * perturbation steps that were needed.
 */
function minesolve(
  gi: Grid,
  n: number,
  board: Int8Array,
  open: OpenCb,
  perturb: PerturbCb | null,
  rs: RandomState,
  onKnown?: KnownCb,
): number {
  const { w, ntiles } = gi;
  const ss: SetStore = { n: 0, allHead: null, allTail: null, todoHead: null, todoTail: null };
  const std: SquareTodo = { next: new Int32Array(ntiles), head: -1, tail: -1 };
  let nperturbs = 0;

  for (let i = 0; i < ntiles; i++) if (board[i] !== -2) stdAdd(std, i);

  for (;;) {
    let doneSomething = false;

    while (std.head !== -1) {
      const tile = std.head;
      std.head = std.next[tile];
      if (std.head === -1) std.tail = -1;

      if (board[tile] >= 0) {
        let mines = board[tile];
        const s = setNew();
        for (const ni of gi.nb[tile]) {
          if (board[ni] === -1) mines--;
          else if (board[ni] === -2) s.tile[s.n++] = ni;
        }
        if (s.n > 0) {
          s.mines = mines;
          ssAdd(ss, s);
        }
      }

      for (const s of ssContains(ss, tile)) {
        setRemoveTile(s, tile);
        if (board[tile] === -1) s.mines--;
        if (s.n === 0) ssRemove(ss, s);
        else ssCheckUniq(ss, s);
      }

      doneSomething = true;
    }

    let s = ssTodo(ss);
    if (s) {
      if (s.mines === 0 || s.mines === s.n) {
        knownSquares(std, board, open, onKnown, s, s.mines !== 0);
        continue;
      }

      for (const s2 of ssOverlap(ss, s)) {
        if (s === s2) continue;
        const wing1 = setNew();
        const wing2 = setNew();
        setWings(s, s2, wing1, wing2);

        if (wing1.n === s.mines - s2.mines || wing2.n === s2.mines - s.mines) {
          knownSquares(std, board, open, onKnown, wing1, wing1.n === s.mines - s2.mines);
          knownSquares(std, board, open, onKnown, wing2, wing2.n === s2.mines - s.mines);
          continue;
        }

        if (wing1.n === 0 && wing2.n !== 0) {
          wing2.mines = s2.mines - s.mines;
          ssAdd(ss, setDup(wing2));
        } else if (wing2.n === 0 && wing1.n !== 0) {
          wing1.mines = s.mines - s2.mines;
          ssAdd(ss, setDup(wing1));
        }
      }

      doneSomething = true;
    } else if (n >= 0) {
      let squaresleft = 0;
      let minesleft = n;
      for (let i = 0; i < ntiles; i++) {
        if (board[i] === -1) minesleft--;
        else if (board[i] === -2) squaresleft++;
      }

      if (squaresleft === 0) break;

      if (minesleft === 0 || minesleft === squaresleft) {
        for (let i = 0; i < ntiles; i++) if (board[i] === -2) knownSquares(std, board, open, onKnown, single(i), minesleft !== 0);
        continue;
      }

      const nsets = ss.n;
      const setused: boolean[] = new Array(10).fill(false);
      if (nsets <= setused.length) {
        const sets: MSet[] = [];
        let it = ss.allHead;
        for (let i = 0; i < nsets; i++) {
          sets.push(it!);
          it = it!.allNext;
        }

        let cursor = 0;
        for (;;) {
          if (cursor < nsets) {
            let ok = true;
            for (let i = 0; i < cursor; i++) {
              if (setused[i] && setOverlap(sets[cursor], sets[i])) {
                ok = false;
                break;
              }
            }
            if (ok) {
              minesleft -= sets[cursor].mines;
              squaresleft -= sets[cursor].n;
            }
            setused[cursor++] = ok;
          } else {
            if (squaresleft > 0 && (minesleft === 0 || minesleft === squaresleft)) {
              for (let i = 0; i < ntiles; i++) {
                if (board[i] !== -2) continue;
                let outside = true;
                for (let j = 0; j < nsets; j++) {
                  if (setused[j] && setContains(sets[j], i)) {
                    outside = false;
                    break;
                  }
                }
                if (outside) knownSquares(std, board, open, onKnown, single(i), minesleft !== 0);
              }
              doneSomething = true;
              break;
            }

            while (--cursor >= 0 && !setused[cursor]);
            if (cursor >= 0) {
              minesleft += sets[cursor].mines;
              squaresleft += sets[cursor].n;
              setused[cursor++] = false;
            } else break;
          }
        }
      }
    }

    if (doneSomething) continue;

    // Reorder the sets as the pre-grid-types version of Mines kept them.
    if (ss.n >= 2) {
      const sa: { set: MSet; tile: number; mask: number }[] = [];
      for (let it = ss.allHead; it; it = it.allNext) {
        let xmin = it.tile[0] % w;
        const ymin = Math.floor(it.tile[0] / w);
        let mask = 1;
        for (let j = 0; j < it.n; j++) {
          const x = it.tile[j] % w;
          const y = Math.floor(it.tile[j] / w);
          if (x < xmin) {
            mask = shortShl(mask, x - xmin);
            xmin = x;
          }
          mask = (((mask + (1 << ((y - ymin) * 3 + (x - xmin)))) << 16) >> 16);
        }
        sa.push({ set: it, tile: ymin * w + xmin, mask });
      }
      qsort(sa, (a, b) => (a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : a.mask < b.mask ? -1 : a.mask > b.mask ? 1 : 0));
      for (let j = 0; j < sa.length - 1; j++) sa[j].set.allNext = sa[j + 1].set;
      for (let j = 1; j < sa.length; j++) sa[j].set.allPrev = sa[j - 1].set;
      sa[0].set.allPrev = null;
      sa[sa.length - 1].set.allNext = null;
      ss.allHead = sa[0].set;
      ss.allTail = sa[sa.length - 1].set;
    }

    if (perturb) {
      nperturbs++;
      let ret: Perturbation[] | null;
      if (ss.allHead === null) {
        ret = perturb(board, null);
      } else {
        let i = randomUpto(rs, ss.n);
        for (s = ss.allHead; i > 0; i--) s = s!.allNext;
        ret = perturb(board, s);
      }

      if (ret) {
        for (const ch of ret) {
          if (ch.delta < 0 && board[ch.tile] !== -2) stdAdd(std, ch.tile);
          for (const set of ssContains(ss, ch.tile)) {
            set.mines += ch.delta;
            ssAddTodo(ss, set);
          }
        }
        continue;
      }
    }

    break;
  }

  for (let i = 0; i < ntiles; i++) if (board[i] === -2) return -1;
  return nperturbs;
}

// ---------------------------------------------------------------------------
// Generator

interface MineCtx {
  mines: Uint8Array;
  opened: Uint8Array;
  w: number;
  h: number;
  grid: Grid;
  startTile: number;
  allowBigPerturbs: boolean;
  nperturbsSinceLastNewOpen: number;
  rs: RandomState;
}

function mineopen(ctx: MineCtx, tile: number): number {
  if (ctx.mines[tile]) return -1;
  if (!ctx.opened[tile]) {
    ctx.opened[tile] = 1;
    ctx.nperturbsSinceLastNewOpen = 0;
  }
  let n = 0;
  for (const ni of ctx.grid.nb[tile]) if (ctx.mines[ni]) n++;
  return n;
}

const isNeighbourOf = (gi: Grid, t1: number, t2: number) => t1 >= 0 && t2 >= 0 && gi.nb[t1].includes(t2);

/**
 * Stand-in for an uninitialised `int` read by mineperturb's partial-fill
 * branch. Upstream fills `setlist[i++]` inside a loop that also increments
 * `i`, leaving gaps whose contents are whatever malloc returned. That branch
 * only runs at extreme mine densities; there the original's behaviour is
 * undefined and this port cannot match it. Gaps are skipped as no-ops.
 */
const UNINIT = -1;

function mineperturb(ctx: MineCtx, board: Int8Array, s: MSet | null): Perturbation[] | null {
  const gi = ctx.grid;
  if (s === null && !ctx.allowBigPerturbs) return null;

  ctx.nperturbsSinceLastNewOpen++;
  if (ctx.nperturbsSinceLastNewOpen >= ctx.w || ctx.nperturbsSinceLastNewOpen >= ctx.h) return null;

  const sqlist: { tile: number; type: number; random: number }[] = [];
  for (let tile = 0; tile < gi.ntiles; tile++) {
    if (tile === ctx.startTile || isNeighbourOf(gi, tile, ctx.startTile)) continue;
    if ((s === null && board[tile] === -2) || (s !== null && setContains(s, tile))) continue;
    let type: number;
    if (board[tile] !== -2) type = 3;
    else {
      type = 2;
      for (const ni of gi.nb[tile]) {
        if (board[ni] !== -2) {
          type = 1;
          break;
        }
      }
    }
    sqlist.push({ tile, type, random: randomBits(ctx.rs, 31) });
  }
  // squarecmp is a total order, so any correct sort matches qsort here.
  sqlist.sort((a, b) => a.type - b.type || a.random - b.random || a.tile - b.tile);

  let nfull = 0, nempty = 0;
  if (s) {
    for (let i = 0; i < s.n; i++) if (ctx.mines[s.tile[i]]) nfull++; else nempty++;
  } else {
    for (let i = 0; i < gi.ntiles; i++) if (board[i] === -2) { if (ctx.mines[i]) nfull++; else nempty++; }
  }

  const tofill: number[] = [];
  const toempty: number[] = [];
  for (const sq of sqlist) {
    if (ctx.mines[sq.tile]) toempty.push(sq.tile);
    else tofill.push(sq.tile);
    if (tofill.length === nfull || toempty.length === nempty) break;
  }

  let setlist: number[] | null = null;
  if (tofill.length !== nfull && toempty.length !== nempty) {
    setlist = new Array(gi.ntiles).fill(UNINIT);
    let i = 0;
    if (s) {
      for (i = 0; i < s.n; i++) {
        const tile = s.tile[i];
        if (!ctx.mines[tile]) setlist[i++] = tile;
      }
    } else {
      for (let tile = 0; tile < gi.ntiles; tile++) if (board[tile] === -2 && !ctx.mines[tile]) setlist[i++] = tile;
    }
    if (!(i > toempty.length)) throw new Error('mineperturb: assertion i > ntoempty failed');
    for (let k = 0; k < toempty.length; k++) {
      const index = k + randomUpto(ctx.rs, i - k);
      [setlist[k], setlist[index]] = [setlist[index], setlist[k]];
    }
  }

  let todo: number[], dtodo: number, dset: number;
  if (tofill.length === nfull) {
    todo = tofill;
    dtodo = +1;
    dset = -1;
  } else {
    todo = toempty;
    dtodo = -1;
    dset = +1;
  }

  const ret: Perturbation[] = todo.map((tile) => ({ tile, delta: dtodo }));
  if (setlist) {
    for (let j = 0; j < toempty.length; j++) ret.push({ tile: setlist[j], delta: dset });
  } else if (s) {
    for (let j = 0; j < s.n; j++) {
      const tile = s.tile[j];
      const currval = ctx.mines[tile] ? +1 : -1;
      if (dset === -currval) ret.push({ tile, delta: dset });
    }
  } else {
    for (let tile = 0; tile < gi.ntiles; tile++) {
      if (board[tile] !== -2) continue;
      const currval = ctx.mines[tile] ? +1 : -1;
      if (dset === -currval) ret.push({ tile, delta: dset });
    }
  }

  const applied = ret.filter((c) => c.tile !== UNINIT);
  for (const { tile, delta } of applied) {
    if ((delta < 0) === (ctx.mines[tile] === 0)) throw new Error('mineperturb: inconsistent change');
    ctx.mines[tile] = delta > 0 ? 1 : 0;
    for (const ni of gi.nb[tile]) if (board[ni] !== -2 && board[ni] >= 0) board[ni] += delta;
    if (board[tile] !== -2) {
      if (delta > 0) board[tile] = -1;
      else {
        let count = 0;
        for (const ni of gi.nb[tile]) if (ctx.mines[ni]) count++;
        board[tile] = count;
      }
    }
  }
  return applied.length ? applied : null;
}

export interface Layout {
  mines: Uint8Array;
  /** Mine count before any were dropped for lack of room. */
  nominal: number;
}

function makeGrid(w: number, h: number): Grid {
  const nb = neighbourTable(w, h);
  if (nb.some((l) => l.length > MAX_NEIGHBOURS)) throw new Error('bad grid');
  return { w, h, ntiles: w * h, nb };
}

/** minegen(): lay mines avoiding `tile` and its neighbours; with `unique`, ensure solvability. */
export function minegen(w: number, h: number, nmines: number, tile: number, unique: boolean, rs: RandomState): Layout {
  const gi = makeGrid(w, h);
  let ntries = 0;
  for (;;) {
    ntries++;
    const mines = new Uint8Array(gi.ntiles);

    const tmp: number[] = [];
    for (let i = 0; i < gi.ntiles; i++) if (i !== tile && !isNeighbourOf(gi, i, tile)) tmp.push(i);
    let k = tmp.length;
    const nominal = nmines;
    const n = Math.min(nmines, k);
    for (let nn = n; nn-- > 0; ) {
      const i = randomUpto(rs, k);
      mines[tmp[i]] = 1;
      tmp[i] = tmp[--k];
    }

    if (!unique) return { mines, nominal };

    const ctx: MineCtx = {
      mines,
      opened: new Uint8Array(gi.ntiles),
      w,
      h,
      grid: gi,
      startTile: tile,
      allowBigPerturbs: ntries > 100,
      nperturbsSinceLastNewOpen: 0,
      rs,
    };
    const open = (t: number) => mineopen(ctx, t);
    const perturb = (board: Int8Array, s: MSet | null) => mineperturb(ctx, board, s);

    let success = false;
    // Upstream declares `prevret` but never updates it, so only -1 or 0 end this loop.
    for (;;) {
      const board = new Int8Array(gi.ntiles).fill(-2);
      board[tile] = mineopen(ctx, tile);
      const ret = minesolve(gi, n, board, open, perturb, rs);
      if (ret < 0) break;
      if (ret === 0) {
        success = true;
        break;
      }
    }
    if (success) return { mines, nominal };
  }
}

/** Whether the solver alone (no perturbation) clears the board from `start`. */
export function isSolvable(w: number, h: number, mines: ArrayLike<number>, start: number): boolean {
  const gi = makeGrid(w, h);
  let n = 0;
  for (let i = 0; i < gi.ntiles; i++) n += mines[i] ? 1 : 0;
  const open = (t: number) => {
    if (mines[t]) return -1;
    let c = 0;
    for (const ni of gi.nb[t]) c += mines[ni] ? 1 : 0;
    return c;
  };
  const board = new Int8Array(gi.ntiles).fill(-2);
  board[start] = open(start);
  return minesolve(gi, n, board, open, null, randomNew('')) === 0;
}

const STOP = Symbol('stop');

/**
 * The first square the solver can determine from a partly played board
 * (0..8 open, -1 known mine, -2 unknown), or null if it's stuck. `mines` is
 * consulted only to report the numbers under squares the solver opens, which
 * it never does before its first deduction.
 */
export function firstDeduction(w: number, h: number, n: number, board: Int8Array, mines: ArrayLike<number>): { tile: number; mine: boolean } | null {
  const gi = makeGrid(w, h);
  let found: { tile: number; mine: boolean } | null = null;
  const open = (t: number) => {
    if (mines[t]) return -1;
    let c = 0;
    for (const ni of gi.nb[t]) c += mines[ni] ? 1 : 0;
    return c;
  };
  try {
    minesolve(gi, n, board.slice(), open, null, randomNew(''), (tile, mine) => {
      found = { tile, mine };
      throw STOP;
    });
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Game IDs

export interface Params {
  w: number;
  h: number;
  n: number;
  unique: boolean;
}

/** encode_params(full): "9x9n10" plus "a" when solubility isn't enforced. */
export function encodeParams(p: Params, full: boolean): string {
  let s = `${p.w}x${p.h}`;
  if (full) s += `n${p.n}${p.unique ? '' : 'a'}`;
  return s;
}

/** A fresh 15-digit seed, as the midend makes them (but from the platform RNG). */
export function newSeed(): string {
  const digits = new Uint8Array(15);
  crypto.getRandomValues(digits);
  return Array.from(digits, (d, i) => (i === 0 ? 1 + (d % 9) : d % 10)).join('');
}

/**
 * The random state that the first click will draw from, given a seed:
 * new_game_desc() consumes a (never used) random first click before
 * encoding the state into the interactive description.
 */
export function stateForSeed(p: Params, seed: string): string {
  const rs = randomNew(seed);
  randomUpto(rs, p.w);
  randomUpto(rs, p.h);
  return randomStateEncode(rs);
}

/** Interactive description, as shown in "Game → Specific…" before the first click. */
export const interactiveDesc = (p: Params, state: string) => `r${p.n},${p.unique ? 'u' : 'a'},${state}`;

export function generateFromState(p: Params, state: string, tile: number): Layout {
  return minegen(p.w, p.h, p.n, tile, p.unique, randomStateDecode(state));
}

function obfuscateBitmap(bmp: Uint8Array, bits: number, decode: boolean) {
  const bytes = (bits + 7) >> 3;
  const first = bytes >> 1;
  const second = bytes - first;
  const steps = [
    { seed: [first, second], target: [0, first] },
    { seed: [0, first], target: [first, second] },
  ];
  if (decode) steps.reverse();
  for (const step of steps) {
    const base = new Sha1().update(bmp.subarray(step.seed[0], step.seed[0] + step.seed[1]));
    let digest: Uint8Array = new Uint8Array(0);
    let digestpos = 20;
    let counter = 0;
    for (let j = 0; j < step.target[1]; j++) {
      if (digestpos >= 20) {
        digest = base.clone().update(ascii(String(counter++))).digest();
        digestpos = 0;
      }
      bmp[step.target[0] + j] ^= digest[digestpos++];
    }
    if (bits % 8) bmp[bits >> 3] &= 0xff & (0xff00 >> (bits % 8));
  }
}

/** describe_layout(): "x,y,m<hex>" with the masked mine bitmap. */
export function describeLayout(w: number, h: number, mines: ArrayLike<number>, tile: number, nominal: number): string {
  const area = w * h;
  const bmp = new Uint8Array((area + 7) >> 3);
  let unplaced = nominal;
  for (let i = 0; i < area; i++) {
    if (mines[i]) {
      bmp[i >> 3] |= 0x80 >> (i % 8);
      unplaced--;
    }
  }
  obfuscateBitmap(bmp, area, false);
  let out = `${tile % w},${Math.floor(tile / w)},m`;
  for (let i = 0; i < (area + 3) >> 2; i++) {
    let v = bmp[i >> 1];
    if (i % 2 === 0) v >>= 4;
    out += '0123456789abcdef'[v & 0xf];
  }
  return unplaced > 0 ? `${out}+${unplaced}` : out;
}

export type ParsedId =
  | { kind: 'seed'; params: Params; seed: string }
  | { kind: 'state'; params: Params; state: string }
  | { kind: 'layout'; params: Params; mines: Uint8Array; start: number };

const atoi = (s: string) => {
  const m = /^\d+/.exec(s);
  return m ? Number(m[0]) : 0;
};

function decodeParams(str: string): Params & { proportion: boolean } {
  let rest = str;
  const take = () => {
    const m = /^\d+/.exec(rest);
    rest = rest.slice(m ? m[0].length : 0);
    return m ? Number(m[0]) : 0;
  };
  const w = take();
  let h = w;
  if (rest[0] === 'x') {
    rest = rest.slice(1);
    h = take();
  }
  if (rest[0] === 't') {
    rest = rest.slice(1);
    if (take() !== 0) throw new Error('Only the square grid is supported');
  }
  let n = 10;
  let proportion = false;
  if (rest[0] === 'n') {
    rest = rest.slice(1);
    n = take();
  } else if (rest[0] === 'p') {
    proportion = true;
  }
  return { w, h, n, unique: !/a/.test(rest), proportion };
}

/**
 * Parses a game ID in any of the original's forms:
 *   "9x9n10#123456789012345"  random seed
 *   "9x9:r10,u,<hex state>"   interactive description (layout made on first click)
 *   "9x9:4,4,m<hex>"          full description (mines fixed, square 4,4 pre-opened)
 */
export function parseGameId(id: string): ParsedId {
  id = id.trim();
  const hash = id.indexOf('#');
  const colon = id.indexOf(':');
  if (hash >= 0 && (colon < 0 || hash < colon)) {
    const params = decodeParams(id.slice(0, hash));
    if (params.proportion) throw new Error('Percentage mine counts are not supported');
    validate(params);
    return { kind: 'seed', params, seed: id.slice(hash + 1) };
  }
  if (colon < 0) throw new Error('A game ID looks like 9x9n10#123… or 9x9:…');
  const params = decodeParams(id.slice(0, colon));
  let desc = id.slice(colon + 1);
  if (desc.includes('_')) throw new Error('Only the square grid is supported');

  if (desc[0] === 'r') {
    desc = desc.slice(1);
    if (desc[0] === 'p') throw new Error('Percentage mine counts are not supported');
    const n = atoi(desc);
    const [, u = 'u', state = ''] = desc.split(',');
    const full = { w: params.w, h: params.h, n, unique: u !== 'a' };
    validate(full);
    if (!/^[0-9a-fA-F]+$/.test(state)) throw new Error('Bad random state in game ID');
    return { kind: 'state', params: full, state };
  }

  const m = /^(\d+),(\d+),([mu]?)([0-9a-fA-F]+)(?:\+(\d+))?$/.exec(desc);
  if (!m) throw new Error('Unrecognised game description');
  const [, xs, ys, mode, hex, extra] = m;
  const { w, h } = params;
  const area = w * h;
  if (hex.length < (area + 3) >> 2) throw new Error('Game description is too short');
  const x = Number(xs), y = Number(ys);
  if (x >= w || y >= h) throw new Error('Starting square is off the board');
  const bmp = new Uint8Array((area + 7) >> 3);
  for (let i = 0; i < (area + 3) >> 2; i++) bmp[i >> 1] |= parseInt(hex[i], 16) << (4 * (1 - (i % 2)));
  if (mode === 'm') obfuscateBitmap(bmp, area, true);
  const mines = new Uint8Array(area);
  let n = extra ? Number(extra) : 0;
  for (let i = 0; i < area; i++) if (bmp[i >> 3] & (0x80 >> (i % 8))) { mines[i] = 1; n++; }
  const start = y * w + x;
  if (mines[start]) throw new Error('Starting square contains a mine');
  return { kind: 'layout', params: { w, h, n, unique: params.unique }, mines, start };
}

function validate(p: Params) {
  if (!(p.w > 0 && p.h > 0)) throw new Error('Width and height must be positive');
  if (p.unique && Math.min(p.w, p.h) <= 2) throw new Error('Width and height must both be greater than two');
  if (Math.max(p.w, p.h) < 4) throw new Error('At least one of width and height must be larger than three');
  if (p.n < 1) throw new Error('Number of mines must be greater than zero');
  if (p.w > 100 || p.h > 100) throw new Error('Board is too large');
}
