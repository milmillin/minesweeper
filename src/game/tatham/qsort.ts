/*
 * Port of musl's qsort (smoothsort, as shipped in Emscripten's libc), with
 * 32-bit size_t as on wasm32. Smoothsort is not stable, so where a comparator
 * reports ties the resulting order is specific to this algorithm — porting it
 * keeps the order identical to the WebAssembly build of the original game.
 */

type Cmp<T> = (a: T, b: T) => number;

const ntz = (x: number) => 31 - Math.clz32(x & -x);

function pntz(p: Uint32Array): number {
  if (p[0] !== 1) return ntz((p[0] - 1) >>> 0);
  if (p[1]) return 32 + ntz(p[1]);
  return 0;
}

function shl(p: Uint32Array, n: number) {
  if (n >= 32) {
    n -= 32;
    p[1] = p[0];
    p[0] = 0;
    if (!n) return;
  }
  p[1] = (p[1] << n) | (p[0] >>> (32 - n));
  p[0] = p[0] << n;
}

function shr(p: Uint32Array, n: number) {
  if (n >= 32) {
    n -= 32;
    p[0] = p[1];
    p[1] = 0;
    if (!n) return;
  }
  // JS, like wasm, masks shift counts to 5 bits, so n == 0 behaves as in the build.
  p[0] = (p[0] >>> n) | (p[1] << (32 - n));
  p[1] = p[1] >>> n;
}

export function qsort<T>(a: T[], cmp: Cmp<T>): void {
  const nel = a.length;
  if (!nel) return;
  const c = (i: number, j: number) => cmp(a[i], a[j]);

  const cycle = (ar: number[], n: number) => {
    if (n < 2) return;
    const tmp = a[ar[0]];
    for (let i = 0; i < n - 1; i++) a[ar[i]] = a[ar[i + 1]];
    a[ar[n - 1]] = tmp;
  };

  const lp: number[] = [1, 1];
  for (let i = 2; (lp[i] = lp[i - 2] + lp[i - 1] + 1) < nel; i++);

  const sift = (head: number, pshift: number) => {
    const ar = [head];
    while (pshift > 1) {
      const rt = head - 1;
      const lf = head - 1 - lp[pshift - 2];
      if (c(ar[0], lf) >= 0 && c(ar[0], rt) >= 0) break;
      if (c(lf, rt) >= 0) {
        ar.push(lf);
        head = lf;
        pshift -= 1;
      } else {
        ar.push(rt);
        head = rt;
        pshift -= 2;
      }
    }
    cycle(ar, ar.length);
  };

  const trinkle = (head: number, pp: Uint32Array, pshift: number, trusty: boolean) => {
    const p = Uint32Array.of(pp[0], pp[1]);
    const ar = [head];
    while (p[0] !== 1 || p[1] !== 0) {
      const stepson = head - lp[pshift];
      if (c(stepson, ar[0]) <= 0) break;
      if (!trusty && pshift > 1) {
        const rt = head - 1;
        const lf = head - 1 - lp[pshift - 2];
        if (c(rt, stepson) >= 0 || c(lf, stepson) >= 0) break;
      }
      ar.push(stepson);
      head = stepson;
      const trail = pntz(p);
      shr(p, trail);
      pshift += trail;
      trusty = false;
    }
    if (!trusty) {
      cycle(ar, ar.length);
      sift(head, pshift);
    }
  };

  let head = 0;
  const high = nel - 1;
  const p = Uint32Array.of(1, 0);
  let pshift = 1;

  while (head < high) {
    if ((p[0] & 3) === 3) {
      sift(head, pshift);
      shr(p, 2);
      pshift += 2;
    } else {
      if (lp[pshift - 1] >= high - head) trinkle(head, p, pshift, false);
      else sift(head, pshift);
      if (pshift === 1) {
        shl(p, 1);
        pshift = 0;
      } else {
        shl(p, pshift - 1);
        pshift = 1;
      }
    }
    p[0] |= 1;
    head++;
  }

  trinkle(head, p, pshift, false);

  while (pshift !== 1 || p[0] !== 1 || p[1] !== 0) {
    if (pshift <= 1) {
      const trail = pntz(p);
      shr(p, trail);
      pshift += trail;
    } else {
      shl(p, 2);
      pshift -= 2;
      p[0] ^= 7;
      shr(p, 1);
      trinkle(head - lp[pshift] - 1, p, pshift + 1, true);
      shl(p, 1);
      p[0] |= 1;
      trinkle(head - 1, p, pshift, true);
    }
    head--;
  }
}
