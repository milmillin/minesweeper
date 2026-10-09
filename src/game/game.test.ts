import { describe, expect, test } from 'vitest';
import { FLAG, gameFromId, gameIds, HIDDEN, newGame, reducer, type Game } from './game';
import { isSolvable } from './tatham/mines';

const cfg = { w: 9, h: 9, n: 10, noGuess: true };

/** Builds a game with a fixed mine layout, already started. */
function withMines(w: number, h: number, mineList: number[]): Game {
  const mines = new Array(w * h).fill(0);
  for (const m of mineList) mines[m] = 1;
  return { ...newGame({ w, h, n: mineList.length, noGuess: false }), mines, status: 'playing' };
}

describe('game IDs', () => {
  test('a seed ID reproduces the same board', () => {
    const a = reducer(gameFromId('16x16n40#987654321098765'), { type: 'reveal', i: 100, now: 0 });
    const b = reducer(gameFromId('16x16n40#987654321098765'), { type: 'reveal', i: 100, now: 0 });
    expect(a.mines).toEqual(b.mines);
    expect(a.desc).toBe(b.desc);
    expect(gameIds(a).seed).toBe('16x16n40#987654321098765');
  });

  test('a description ID restores the layout with the start opened', () => {
    const played = reducer(newGame(cfg), { type: 'reveal', i: 40, now: 0 });
    const loaded = gameFromId(played.desc!);
    expect(loaded.mines).toEqual(played.mines);
    expect(loaded.cells).toEqual(played.cells);
  });

  test('an interactive description generates on first click like the seed', () => {
    const fromSeed = gameFromId('9x9n10#111111111111111');
    const fromState = gameFromId(gameIds(fromSeed).desc);
    const a = reducer(fromSeed, { type: 'reveal', i: 0, now: 0 });
    const b = reducer(fromState, { type: 'reveal', i: 0, now: 0 });
    expect(b.mines).toEqual(a.mines);
  });

  test('bad IDs are rejected', () => {
    expect(() => gameFromId('nonsense')).toThrow();
    expect(() => gameFromId('9x9t2n10#1')).toThrow(/square/);
    expect(() => gameFromId('2x2n1#1')).toThrow();
  });
});

describe('generation', () => {
  test.each([
    [9, 9, 10],
    [9, 9, 35],
    [16, 16, 99],
    [30, 16, 99],
  ])('%ix%i/%i: first click opens a zero and the board is solvable', (w, h, n) => {
    for (let k = 0; k < 10; k++) {
      const start = (k * 37) % (w * h);
      const g = reducer(newGame({ w, h, n, noGuess: true }, String(400000000000000 + k)), { type: 'reveal', i: start, now: 0 });
      expect(g.cells[start]).toBe(0);
      expect(g.mines!.reduce((a, b) => a + b, 0)).toBe(n);
      expect(isSolvable(w, h, g.mines!, start)).toBe(true);
    }
  });
});

describe('reducer', () => {
  test('first reveal generates and opens a region', () => {
    const g = reducer(newGame(cfg), { type: 'reveal', i: 40, now: 0 });
    expect(g.status).toBe('playing');
    expect(g.mines).not.toBeNull();
    expect(g.cells[40]).toBe(0);
    expect(g.since).toBe(0);
  });

  test('hitting a mine loses; undo returns to playing', () => {
    let g = withMines(3, 3, [8]);
    g = reducer(g, { type: 'reveal', i: 8, now: 100 });
    expect(g.status).toBe('lost');
    expect(g.hit).toBe(8);
    g = reducer(g, { type: 'undo', now: 200 });
    expect(g.status).toBe('playing');
    expect(g.cells[8]).toBe(HIDDEN);
    g = reducer(g, { type: 'redo', now: 300 });
    expect(g.status).toBe('lost');
  });

  test('flood fill and win auto-flags', () => {
    let g = withMines(3, 3, [8]);
    g = reducer(g, { type: 'reveal', i: 0, now: 0 });
    expect(g.status).toBe('won');
    expect(g.cells[8]).toBe(FLAG);
    expect(g.cells[4]).toBe(1);
  });

  test('chord opens neighbours when flags match', () => {
    // mines at 0 and 2 in a 3×3; reveal 4 (count 2), flag both, chord.
    let g = withMines(3, 3, [0, 2]);
    g = reducer(g, { type: 'reveal', i: 4, now: 0 });
    expect(g.cells[4]).toBe(2);
    g = reducer(g, { type: 'reveal', i: 4, now: 0 });
    expect(g.cells[1]).toBe(HIDDEN); // no flags yet → no chord
    g = reducer(g, { type: 'flag', i: 0 });
    g = reducer(g, { type: 'flag', i: 2 });
    g = reducer(g, { type: 'reveal', i: 4, now: 0 });
    expect(g.status).toBe('won');
  });

  test('chord with a wrong flag loses', () => {
    let g = withMines(3, 3, [0]);
    g = reducer(g, { type: 'reveal', i: 4, now: 0 });
    g = reducer(g, { type: 'flag', i: 2 });
    g = reducer(g, { type: 'reveal', i: 4, now: 0 });
    expect(g.status).toBe('lost');
    expect(g.hit).toBe(0);
  });

  test('flagged cells cannot be revealed', () => {
    let g = withMines(3, 3, [8]);
    g = reducer(g, { type: 'flag', i: 8 });
    expect(reducer(g, { type: 'reveal', i: 8, now: 0 })).toBe(g);
  });

  test('timer pauses on loss and resumes on undo', () => {
    let g = withMines(3, 3, [0, 8]);
    g = reducer(g, { type: 'reveal', i: 4, now: 1000 });
    expect(g.status).toBe('playing');
    g = reducer(g, { type: 'reveal', i: 8, now: 4000 });
    expect(g.since).toBeNull();
    expect(g.accum).toBe(3000);
    g = reducer(g, { type: 'undo', now: 9000 });
    expect(g.since).toBe(9000);
  });
});
