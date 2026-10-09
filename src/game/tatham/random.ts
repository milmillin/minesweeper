/*
 * Port of random.c from Simon Tatham's Portable Puzzle Collection:
 * a SHA-1 based PRNG. Byte-for-byte compatible, so the same seed string
 * produces the same stream of numbers as the original.
 */

const rol = (x: number, y: number) => ((x << y) | (x >>> (32 - y))) >>> 0;

function shaTransform(h: Uint32Array, block: Uint32Array) {
  const w = new Uint32Array(80);
  for (let t = 0; t < 16; t++) w[t] = block[t];
  for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
  for (let t = 0; t < 80; t++) {
    let f: number, k: number;
    if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
    else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
    else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
    else { f = b ^ c ^ d; k = 0xca62c1d6; }
    const tmp = (rol(a, 5) + (f >>> 0) + e + w[t] + k) >>> 0;
    e = d; d = c; c = rol(b, 30); b = a; a = tmp;
  }
  h[0] = (h[0] + a) >>> 0;
  h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0;
  h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0;
}

/** Incremental SHA-1 (SHA_State in the original), copyable for obfuscate_bitmap. */
export class Sha1 {
  h = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0);
  block = new Uint8Array(64);
  used = 0;
  len = 0;

  clone(): Sha1 {
    const s = new Sha1();
    s.h.set(this.h);
    s.block.set(this.block);
    s.used = this.used;
    s.len = this.len;
    return s;
  }

  update(bytes: ArrayLike<number>): this {
    const wb = new Uint32Array(16);
    for (let i = 0; i < bytes.length; i++) {
      this.block[this.used++] = bytes[i];
      this.len++;
      if (this.used === 64) {
        for (let j = 0; j < 16; j++)
          wb[j] = ((this.block[j * 4] << 24) | (this.block[j * 4 + 1] << 16) | (this.block[j * 4 + 2] << 8) | this.block[j * 4 + 3]) >>> 0;
        shaTransform(this.h, wb);
        this.used = 0;
      }
    }
    return this;
  }

  digest(): Uint8Array {
    const bits = this.len * 8;
    const pad = this.used >= 56 ? 56 + 64 - this.used : 56 - this.used;
    const tail = new Uint8Array(pad + 8);
    tail[0] = 0x80;
    const hi = Math.floor(bits / 2 ** 32);
    const lo = bits >>> 0;
    tail[pad] = hi >>> 24; tail[pad + 1] = (hi >>> 16) & 0xff; tail[pad + 2] = (hi >>> 8) & 0xff; tail[pad + 3] = hi & 0xff;
    tail[pad + 4] = lo >>> 24; tail[pad + 5] = (lo >>> 16) & 0xff; tail[pad + 6] = (lo >>> 8) & 0xff; tail[pad + 7] = lo & 0xff;
    this.update(tail);
    const out = new Uint8Array(20);
    for (let i = 0; i < 5; i++) {
      out[i * 4] = this.h[i] >>> 24;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }
}

export const sha1 = (bytes: ArrayLike<number>) => new Sha1().update(bytes).digest();
export const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export interface RandomState {
  seedbuf: Uint8Array; // 40 bytes
  databuf: Uint8Array; // 20 bytes
  pos: number;
}

export function randomNew(seed: string): RandomState {
  const seedbuf = new Uint8Array(40);
  seedbuf.set(sha1(ascii(seed)), 0);
  seedbuf.set(sha1(seedbuf.subarray(0, 20)), 20);
  return { seedbuf, databuf: sha1(seedbuf), pos: 0 };
}

/** random_bits(): `bits` ≤ 31, matching a 32-bit `unsigned long`. */
export function randomBits(rs: RandomState, bits: number): number {
  let ret = 0;
  for (let n = 0; n < bits; n += 8) {
    if (rs.pos >= 20) {
      for (let i = 0; i < 20; i++) {
        if (rs.seedbuf[i] !== 0xff) {
          rs.seedbuf[i]++;
          break;
        }
        rs.seedbuf[i] = 0;
      }
      rs.databuf = sha1(rs.seedbuf);
      rs.pos = 0;
    }
    ret = ((ret << 8) | rs.databuf[rs.pos++]) >>> 0;
  }
  return (ret & (2 ** bits - 1)) >>> 0;
}

export function randomUpto(rs: RandomState, limit: number): number {
  let bits = 0;
  while (Math.floor(limit / 2 ** bits) !== 0) bits++;
  bits += 3;
  if (bits >= 32) throw new Error('random_upto: limit too large');
  const divisor = Math.floor(2 ** bits / limit);
  const max = limit * divisor;
  let data: number;
  do data = randomBits(rs, bits);
  while (data >= max);
  return Math.floor(data / divisor);
}

const hex2 = (b: number) => b.toString(16).padStart(2, '0');

export function randomStateEncode(rs: RandomState): string {
  return [...rs.seedbuf, ...rs.databuf].map(hex2).join('') + hex2(rs.pos);
}

export function randomStateDecode(input: string): RandomState {
  const rs: RandomState = { seedbuf: new Uint8Array(40), databuf: new Uint8Array(20), pos: 0 };
  let byte = 0, digits = 0, pos = 0;
  for (const ch of input) {
    let v = parseInt(ch, 16);
    if (Number.isNaN(v)) v = 0;
    byte = ((byte << 4) | v) & 0xff;
    if (++digits === 2) {
      if (pos < 40) rs.seedbuf[pos++] = byte;
      else if (pos < 60) rs.databuf[pos++ - 40] = byte;
      else if (pos === 60 && byte <= 20) rs.pos = byte;
      byte = digits = 0;
    }
  }
  return rs;
}
