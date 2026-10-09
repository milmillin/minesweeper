import { describe, expect, test } from 'vitest';
import { gameFromId, HIDDEN, newGame, reducer, type Game } from './game';
import { findHint } from './hint';

const apply = (g: Game, h: ReturnType<typeof findHint>) =>
  reducer(g, { type: 'apply', safe: h.safe, mines: h.mines, unflag: h.wrong, now: 0 });

describe('findHint', () => {
  test.each([
    [9, 9, 10],
    [9, 9, 35],
    [16, 16, 40],
    [16, 16, 99],
    [30, 16, 99],
    [30, 16, 170],
  ])('%ix%i/%i boards can be cleared by following hints alone', (w, h, n) => {
    const rules = new Map<string, number>();
    for (let k = 0; k < 6; k++) {
      let g = reducer(newGame({ w, h, n, noGuess: true }, String(300000000000000 + k * 7)), { type: 'reveal', i: (k * 53) % (w * h), now: 0 });
      for (let step = 0; g.status === 'playing'; step++) {
        expect(step).toBeLessThan(w * h);
        const hint = findHint(g);
        expect(hint.safe.length + hint.mines.length).toBeGreaterThan(0);
        for (const i of hint.safe) expect(g.mines![i]).toBe(0);
        for (const i of hint.mines) expect(g.mines![i]).toBe(1);
        const rule = hint.text.split(' ').slice(0, 3).join(' ');
        rules.set(rule, (rules.get(rule) ?? 0) + 1);
        g = apply(g, hint);
      }
      expect(g.status).toBe('won');
    }
  });

  test('points out a wrong flag before anything else', () => {
    let g = reducer(gameFromId('9x9n10#123456789012345'), { type: 'reveal', i: 40, now: 0 });
    const notMine = g.cells.findIndex((c, i) => c === HIDDEN && !g.mines![i]);
    g = reducer(g, { type: 'flag', i: notMine });
    const hint = findHint(g);
    expect(hint.wrong).toEqual([notMine]);
    g = apply(g, hint);
    expect(g.cells[notMine]).toBe(HIDDEN);
  });

  test('applying a hint is one undo step', () => {
    let g = reducer(gameFromId('9x9n10#123456789012345'), { type: 'reveal', i: 40, now: 0 });
    const before = g.cells;
    g = apply(g, findHint(g));
    expect(g.cells).not.toEqual(before);
    expect(reducer(g, { type: 'undo', now: 0 }).cells).toEqual(before);
  });

  test('explains a single-number deduction', () => {
    // 3×3 with a mine in the corner; only that corner is still hidden.
    const g: Game = {
      ...newGame({ w: 3, h: 3, n: 1, noGuess: false }),
      mines: [0, 0, 0, 0, 0, 0, 0, 0, 1],
      cells: [0, 0, 0, 0, 1, 1, 0, 1, HIDDEN],
      status: 'playing',
    };
    const hint = findHint(g);
    expect(hint.mines).toEqual([8]);
    expect(hint.sources).toEqual([4]);
    expect(hint.text).toBe('This 1 has exactly 1 hidden neighbour, so it’s a mine.');
  });

  test('messages outside play', () => {
    expect(findHint(newGame({ w: 9, h: 9, n: 10, noGuess: true })).text).toMatch(/first tap/);
  });
});
