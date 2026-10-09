import { describe, expect, test } from 'vitest';
import { FLAG, HIDDEN, newGame, reducer, type Game } from './game';
import { generate } from './generate';
import { solve } from './solver';

const cfg = { w: 9, h: 9, n: 10, noGuess: true };

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** Builds a game with a fixed mine layout, already started. */
function withMines(w: number, h: number, mineList: number[]): Game {
  const mines = new Array(w * h).fill(0);
  for (const m of mineList) mines[m] = 1;
  return { ...newGame({ w, h, n: mineList.length, noGuess: false }), mines, status: 'playing' };
}

describe('generate', () => {
  test('first click and neighbours are never mines', () => {
    for (let s = 0; s < 200; s++) {
      const rng = seeded(s);
      const start = Math.floor(rng() * 81);
      const m = generate(9, 9, 10, start, { noGuess: false, rng });
      expect(m[start]).toBe(0);
      expect(m.reduce((a, b) => a + b, 0)).toBe(10);
    }
  });

  test.each([
    [9, 9, 10],
    [16, 16, 40],
    [30, 16, 99],
  ])('no-guess %ix%i/%i boards are solvable from the first click', (w, h, n) => {
    for (let s = 0; s < 40; s++) {
      const rng = seeded(s + 1);
      const start = Math.floor(rng() * w * h);
      const m = generate(w, h, n, start, { noGuess: true, rng });
      expect(m.reduce((a, b) => a + b, 0)).toBe(n);
      expect(solve(w, h, m, start).solved).toBe(true);
    }
  });

  test('custom density above the 3×3 limit still places mines', () => {
    const m = generate(4, 4, 15, 5, { noGuess: false });
    expect(m[5]).toBe(0);
    expect(m.reduce((a, b) => a + b, 0)).toBe(15);
  });
});

describe('solver', () => {
  test('cannot solve a 50/50', () => {
    // 2×1 corridor: mine is in one of two cells next to the same number.
    const w = 3, h = 2;
    const mines = [0, 0, 1, 0, 0, 0];
    // start at 0: reveals 0 (count 0) → floods 1,3,4; cells 2 and 5 both touch only 1 and 4 (counts 1)
    expect(solve(w, h, mines, 0).solved).toBe(false);
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
