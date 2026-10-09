import { countAdjacent, neighbourTable } from './grid';
import {
  describeLayout,
  encodeParams,
  generateFromState,
  interactiveDesc,
  newSeed,
  parseGameId,
  stateForSeed,
  type Params,
} from './tatham/mines';

/** Cell display codes. 0–8 are revealed counts. */
export const HIDDEN = -1;
export const FLAG = -2;

export type Status = 'ready' | 'playing' | 'won' | 'lost';

export interface Config {
  w: number;
  h: number;
  n: number;
  noGuess: boolean;
}

interface Snapshot {
  cells: string;
  status: Status;
  hit: number;
}

export interface Game extends Config {
  /** 0/1 per cell; null until the first reveal. */
  mines: number[] | null;
  /** Random seed from the game ID ("9x9n10#<seed>"), when there is one. */
  seed: string | null;
  /** Encoded random state the first click generates the layout from. */
  rstate: string | null;
  /** Full game ID once the layout exists ("9x9:4,4,m…"). */
  desc: string | null;
  cells: number[];
  status: Status;
  /** Index of the mine that ended the game, or -1. */
  hit: number;
  /** Timer: accumulated ms plus the running segment since `since`. */
  accum: number;
  since: number | null;
  /** Clock stopped because the page was hidden. */
  paused?: boolean;
  /** Hints shown this game. */
  hints?: number;
  past: Snapshot[];
  future: Snapshot[];
}

export type Action =
  | { type: 'reveal'; i: number; now: number }
  | { type: 'flag'; i: number }
  | { type: 'undo'; now: number }
  | { type: 'redo'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'restart' }
  | { type: 'hint' }
  | { type: 'apply'; safe: number[]; mines: number[]; unflag: number[]; now: number }
  | { type: 'new'; config: Config }
  | { type: 'load'; game: Game };

const HISTORY_LIMIT = 500;

const params = (c: Config): Params => ({ w: c.w, h: c.h, n: c.n, unique: c.noGuess });

export function newGame(config: Config, seed = newSeed()): Game {
  return { ...blankGame(config), seed, rstate: stateForSeed(params(config), seed) };
}

function blankGame({ w, h, n, noGuess }: Config): Game {
  return {
    w,
    h,
    n,
    noGuess,
    mines: null,
    seed: null,
    rstate: null,
    desc: null,
    cells: new Array(w * h).fill(HIDDEN),
    status: 'ready',
    hit: -1,
    accum: 0,
    since: null,
    past: [],
    future: [],
  };
}

/** Starts a game from an ID in any of the original's formats. Throws on a bad ID. */
export function gameFromId(id: string): Game {
  const parsed = parseGameId(id);
  const { w, h, n, unique } = parsed.params;
  const config = { w, h, n, noGuess: unique };
  switch (parsed.kind) {
    case 'seed':
      return newGame(config, parsed.seed);
    case 'state':
      return { ...blankGame(config), rstate: parsed.state };
    case 'layout': {
      const mines = Array.from(parsed.mines);
      const g: Game = { ...blankGame(config), mines, status: 'playing', desc: `${w}x${h}:${describeLayout(w, h, mines, parsed.start, n)}` };
      open(g, mines, countAdjacent(w, h, mines), g.cells, [parsed.start]);
      return g;
    }
  }
}

/** The IDs that reproduce this game: by random seed, and by description. */
export function gameIds(g: Game): { seed: string | null; desc: string } {
  return {
    seed: g.seed === null ? null : `${encodeParams(params(g), true)}#${g.seed}`,
    desc: g.desc ?? `${g.w}x${g.h}:${interactiveDesc(params(g), g.rstate ?? '')}`,
  };
}

export function elapsed(g: Game, now: number): number {
  return g.accum + (g.since === null ? 0 : now - g.since);
}

export function flagsPlaced(g: Game): number {
  let f = 0;
  for (const c of g.cells) if (c === FLAG) f++;
  return f;
}

const encode = (cells: number[]) => cells.map((c) => (c === HIDDEN ? '.' : c === FLAG ? 'F' : String(c))).join('');
const decode = (s: string) => Array.from(s, (ch) => (ch === '.' ? HIDDEN : ch === 'F' ? FLAG : Number(ch)));
const snapshot = (g: Game): Snapshot => ({ cells: encode(g.cells), status: g.status, hit: g.hit });

/** Starts or stops the clock to match a status change. */
function retime(g: Game, prev: Status, next: Status, now: number): Pick<Game, 'accum' | 'since'> {
  const wasRunning = prev === 'playing' && g.since !== null;
  const running = next === 'playing';
  if (wasRunning && !running) return { accum: g.accum + now - g.since!, since: null };
  if (!wasRunning && running) return { accum: g.accum, since: now };
  return { accum: g.accum, since: g.since };
}

/** Opens cells (flood-filling zeros). Returns the first mine hit, or -1. */
function open(g: Game, mines: number[], adj: Int8Array, cells: number[], targets: number[]): number {
  const nb = neighbourTable(g.w, g.h);
  const stack = [...targets];
  let hit = -1;
  while (stack.length) {
    const c = stack.pop()!;
    if (cells[c] !== HIDDEN) continue;
    if (mines[c]) {
      if (hit < 0) hit = c;
      continue;
    }
    cells[c] = adj[c];
    if (adj[c] === 0) for (const n of nb[c]) if (cells[n] === HIDDEN) stack.push(n);
  }
  return hit;
}

function revealOrChord(g: Game, i: number, now: number): Game {
  if (g.status === 'won' || g.status === 'lost') return g;
  if (g.cells[i] === FLAG) return g;

  let { mines, desc, n } = g;
  let status: Status = g.status;
  if (!mines) {
    const layout = generateFromState(params(g), g.rstate!, i);
    mines = Array.from(layout.mines);
    n = layout.nominal;
    desc = `${g.w}x${g.h}:${describeLayout(g.w, g.h, mines, i, layout.nominal)}`;
    status = 'playing';
  }
  const adj = countAdjacent(g.w, g.h, mines);
  const nb = neighbourTable(g.w, g.h);
  let targets: number[];

  if (g.cells[i] === HIDDEN) {
    targets = [i];
  } else {
    // Chord: a number whose flags are all placed opens its other neighbours.
    let flags = 0;
    const hidden: number[] = [];
    for (const n of nb[i]) {
      if (g.cells[n] === FLAG) flags++;
      else if (g.cells[n] === HIDDEN) hidden.push(n);
    }
    if (flags !== g.cells[i] || !hidden.length) return g;
    targets = hidden;
  }

  const cells = g.cells.slice();
  const hit = open(g, mines, adj, cells, targets);
  if (hit >= 0) {
    status = 'lost';
  } else if (cells.every((c, k) => c >= 0 || mines![k])) {
    status = 'won';
    for (let k = 0; k < cells.length; k++) if (mines[k]) cells[k] = FLAG;
  }

  return {
    ...g,
    mines,
    desc,
    n,
    cells,
    status,
    hit,
    ...retime(g, g.status, status, now),
    past: [...g.past, snapshot(g)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** Makes a hint's moves as one undoable step: remove wrong flags, flag mines, open safe cells. */
function applyHint(g: Game, a: Extract<Action, { type: 'apply' }>): Game {
  if (g.status !== 'playing' || !g.mines) return g;
  const mines = g.mines;
  const cells = g.cells.slice();
  for (const i of a.unflag) if (cells[i] === FLAG) cells[i] = HIDDEN;
  for (const i of a.mines) if (cells[i] === HIDDEN) cells[i] = FLAG;
  const hit = open(g, mines, countAdjacent(g.w, g.h, mines), cells, a.safe.filter((i) => cells[i] === HIDDEN));
  let status: Status = g.status;
  if (hit >= 0) status = 'lost';
  else if (cells.every((c, k) => c >= 0 || mines[k])) {
    status = 'won';
    for (let k = 0; k < cells.length; k++) if (mines[k]) cells[k] = FLAG;
  }
  return {
    ...g,
    cells,
    status,
    hit,
    ...retime(g, g.status, status, a.now),
    past: [...g.past, snapshot(g)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** Cells right after the first click, whose square is recorded in the description ("9x9:x,y,m…"). */
function openingCells(g: Game, mines: number[]): number[] {
  const cells = new Array(g.w * g.h).fill(HIDDEN);
  const m = /^\d+x\d+:(\d+),(\d+),/.exec(g.desc ?? '');
  if (m) open(g, mines, countAdjacent(g.w, g.h, mines), cells, [Number(m[2]) * g.w + Number(m[1])]);
  return cells;
}

function restore(g: Game, s: Snapshot, now: number): Game {
  return { ...g, cells: decode(s.cells), status: s.status, hit: s.hit, ...retime(g, g.status, s.status, now) };
}

export function reducer(g: Game, a: Action): Game {
  switch (a.type) {
    case 'reveal':
      return revealOrChord(g, a.i, a.now);
    case 'flag': {
      if (g.status === 'won' || g.status === 'lost') return g;
      const c = g.cells[a.i];
      if (c !== HIDDEN && c !== FLAG) return g;
      const cells = g.cells.slice();
      cells[a.i] = c === FLAG ? HIDDEN : FLAG;
      return { ...g, cells, past: [...g.past, snapshot(g)].slice(-HISTORY_LIMIT), future: [] };
    }
    case 'undo': {
      const prev = g.past[g.past.length - 1];
      if (!prev) return g;
      // Undoing to before the first move keeps the generated mines but leaves the clock at zero.
      const status = prev.status === 'ready' ? 'playing' : prev.status;
      return {
        ...restore(g, { ...prev, status }, a.now),
        past: g.past.slice(0, -1),
        future: [snapshot(g), ...g.future],
      };
    }
    case 'redo': {
      const next = g.future[0];
      if (!next) return g;
      return { ...restore(g, next, a.now), past: [...g.past, snapshot(g)], future: g.future.slice(1) };
    }
    case 'pause':
      return g.since === null ? g : { ...g, accum: g.accum + a.now - g.since, since: null, paused: true };
    case 'resume':
      return g.paused ? { ...g, since: g.status === 'playing' ? a.now : null, paused: false } : g;
    case 'restart': {
      // Back to the board as first opened, like the original's Restart. It's a move, so Undo reverses it.
      if (!g.mines) return g;
      const cells = openingCells(g, g.mines);
      if (g.status === 'playing' && encode(cells) === encode(g.cells)) return g;
      return {
        ...g,
        cells,
        status: 'playing',
        hit: -1,
        accum: 0,
        since: null,
        paused: false,
        past: [...g.past, snapshot(g)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }
    case 'hint':
      return { ...g, hints: (g.hints ?? 0) + 1 };
    case 'apply':
      return applyHint(g, a);
    case 'new':
      return newGame(a.config);
    case 'load':
      return a.game;
  }
}
