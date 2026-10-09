export interface Preset {
  w: number;
  h: number;
  n: number;
}

/** The square-grid presets from Tatham's Mines. */
export const PRESETS: Preset[] = [
  { w: 9, h: 9, n: 10 },
  { w: 9, h: 9, n: 35 },
  { w: 16, h: 16, n: 40 },
  { w: 16, h: 16, n: 99 },
  { w: 30, h: 16, n: 99 },
  { w: 30, h: 16, n: 170 },
];

export interface Settings {
  w: number;
  h: number;
  n: number;
  noGuess: boolean;
  haptics: boolean;
  /** Rotate wide boards to fit portrait screens. */
  autoRotate: boolean;
}

export const DEFAULT_SETTINGS: Settings = { w: 9, h: 9, n: 10, noGuess: true, haptics: true, autoRotate: true };

export const LIMITS = { min: 3, maxW: 50, maxH: 50 };

/** Largest mine count that still leaves the 3×3 around the first click clear. */
export const maxMines = (w: number, h: number) => Math.max(1, w * h - 9);

export const bestKey = (s: { w: number; h: number; n: number; noGuess: boolean }) =>
  `${s.w}x${s.h}x${s.n}${s.noGuess ? '' : 'r'}`;

export const sizeLabel = (s: { w: number; h: number; n: number }) => `${s.w}×${s.h}, ${s.n} mines`;
