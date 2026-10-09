/**
 * Haptic feedback.
 * - Android (Chrome, Firefox): Vibration API.
 * - iOS Safari 18+: no Vibration API, but toggling an `<input type="checkbox" switch>`
 *   through its label plays the system switch haptic. Best-effort only.
 */
export type HapticKind = 'tap' | 'flag' | 'lose' | 'win';

const PATTERNS: Record<HapticKind, number[]> = {
  tap: [8],
  flag: [18],
  lose: [70, 50, 140],
  win: [20, 60, 20, 60, 40],
};

let enabled = true;
let label: HTMLLabelElement | null = null;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function iosSwitch(): HTMLLabelElement {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'haptic-switch';
  input.tabIndex = -1;
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  for (const el of [input, label]) {
    Object.assign(el.style, { position: 'fixed', left: '-100px', top: '0', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(el);
  }
  return label;
}

export function haptic(kind: HapticKind) {
  if (!enabled) return;
  const pattern = PATTERNS[kind];
  if (canVibrate()) {
    navigator.vibrate(pattern);
    return;
  }
  const el = iosSwitch();
  // One switch tick per "on" segment of the pattern.
  let t = 0;
  for (let k = 0; k < pattern.length; k += 2) {
    if (t === 0) el.click();
    else setTimeout(() => el.click(), t);
    t += pattern[k] + (pattern[k + 1] ?? 0);
  }
}

export const hapticsSupported = () =>
  canVibrate() || (typeof navigator !== 'undefined' && /iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent));
