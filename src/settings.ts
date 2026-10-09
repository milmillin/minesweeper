export interface Preset {
  id: string;
  label: string;
  w: number;
  h: number;
  n: number;
}

export const PRESETS: Preset[] = [
  { id: 'beginner', label: 'Beginner', w: 9, h: 9, n: 10 },
  { id: 'intermediate', label: 'Intermediate', w: 16, h: 16, n: 40 },
  { id: 'expert', label: 'Expert', w: 30, h: 16, n: 99 },
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

export const LIMITS = { min: 4, maxW: 50, maxH: 50 };

export const bestKey = (s: { w: number; h: number; n: number; noGuess: boolean }) =>
  `${s.w}x${s.h}x${s.n}${s.noGuess ? '' : 'r'}`;

export function presetLabel(s: { w: number; h: number; n: number }) {
  const p = PRESETS.find((p) => p.w === s.w && p.h === s.h && p.n === s.n);
  return p ? p.label : 'Custom';
}
