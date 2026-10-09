const cache = new Map<string, Int32Array[]>();

/** Neighbour indices (up to 8) for every cell of a w×h grid, memoised per size. */
export function neighbourTable(w: number, h: number): Int32Array[] {
  const key = `${w}x${h}`;
  let table = cache.get(key);
  if (table) return table;
  table = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const list: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
        }
      }
      table[y * w + x] = Int32Array.from(list);
    }
  }
  cache.set(key, table);
  return table;
}

export function countAdjacent(w: number, h: number, mines: ArrayLike<number>): Int8Array {
  const nb = neighbourTable(w, h);
  const out = new Int8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let c = 0;
    for (const n of nb[i]) c += mines[n];
    out[i] = c;
  }
  return out;
}
