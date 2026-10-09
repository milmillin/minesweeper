import { describe, expect, test } from 'vitest';
import cases from './__fixtures__/oracle.json';
import { describeLayout, generateFromState, interactiveDesc, stateForSeed } from './mines';

/*
 * Recorded from the WebAssembly build of Mines on Tatham's site (puzzles
 * 20260923.616da16): load "<params>#<seed>", click (x, y), then read the
 * interactive description before the click and the full one after it.
 */
describe('matches the original game', () => {
  test.each(cases.map((c) => [`${c.w}x${c.h}n${c.n}${c.unique ? '' : 'a'}#${c.seed} @${c.x},${c.y}`, c] as const))('%s', (_, c) => {
    const p = { w: c.w, h: c.h, n: c.n, unique: c.unique };
    const state = stateForSeed(p, c.seed);
    expect(`${c.w}x${c.h}:${interactiveDesc(p, state)}`).toBe(c.before);
    const tile = c.y * c.w + c.x;
    const { mines, nominal } = generateFromState(p, state, tile);
    expect(`${c.w}x${c.h}:${describeLayout(c.w, c.h, mines, tile, nominal)}`).toBe(c.desc);
  });
});
