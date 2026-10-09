import { describe, expect, test } from 'vitest';
import { qsort } from './qsort';
import { ascii, randomNew, randomStateDecode, randomStateEncode, randomUpto, sha1 } from './random';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('sha1', () => {
  test('standard vectors', () => {
    expect(hex(sha1(ascii('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(ascii('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(ascii('a'.repeat(1000))))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
  });
});

describe('random state', () => {
  test('encode/decode round-trips mid-stream', () => {
    const rs = randomNew('42');
    for (let i = 0; i < 50; i++) randomUpto(rs, 81);
    const copy = randomStateDecode(randomStateEncode(rs));
    for (let i = 0; i < 50; i++) expect(randomUpto(copy, 1000)).toBe(randomUpto(rs, 1000));
  });
});

describe('qsort', () => {
  test('sorts like Array.prototype.sort under a total order', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647);
    for (let len = 0; len < 300; len += 7) {
      const a = Array.from({ length: len }, () => rnd() % 50);
      const b = a.slice();
      qsort(a, (x, y) => x - y);
      expect(a).toEqual(b.sort((x, y) => x - y));
    }
  });
});
