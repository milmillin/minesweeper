import { useEffect, useRef, useState } from 'react';
import { maxMines } from '../game/generate';
import { hapticsSupported } from '../lib/haptics';
import { LIMITS, PRESETS, type Settings } from '../settings';

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  /** Applies settings; `restart` when the board shape or generator changed. */
  onApply: (s: Settings, restart: boolean) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v) || lo));

export function SettingsSheet({ open, settings, onClose, onApply }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setDraft(settings);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, settings]);

  const preset = PRESETS.find((p) => p.w === draft.w && p.h === draft.h && p.n === draft.n);
  const [custom, setCustom] = useState(!preset);
  useEffect(() => {
    if (open) setCustom(!PRESETS.some((p) => p.w === settings.w && p.h === settings.h && p.n === settings.n));
  }, [open, settings]);

  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const setSize = (patch: Partial<Pick<Settings, 'w' | 'h' | 'n'>>) =>
    setDraft((d) => {
      const w = clamp(patch.w ?? d.w, LIMITS.min, LIMITS.maxW);
      const h = clamp(patch.h ?? d.h, LIMITS.min, LIMITS.maxH);
      const n = clamp(patch.n ?? d.n, 1, maxMines(w, h));
      return { ...d, w, h, n };
    });

  const apply = () => {
    const restart = draft.w !== settings.w || draft.h !== settings.h || draft.n !== settings.n || draft.noGuess !== settings.noGuess;
    onApply(draft, restart);
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <h2>Game</h2>
        <div className="segmented" role="radiogroup" aria-label="Difficulty">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              role="radio"
              aria-checked={!custom && preset?.id === p.id}
              onClick={() => {
                setCustom(false);
                setSize(p);
              }}
            >
              <span>{p.label}</span>
              <small>
                {p.w}×{p.h} · {p.n}
              </small>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)}>
            <span>Custom</span>
            <small>…</small>
          </button>
        </div>

        {custom && (
          <div className="custom">
            <NumberField label="Width" value={draft.w} min={LIMITS.min} max={LIMITS.maxW} onChange={(w) => setSize({ w })} />
            <NumberField label="Height" value={draft.h} min={LIMITS.min} max={LIMITS.maxH} onChange={(h) => setSize({ h })} />
            <NumberField label="Mines" value={draft.n} min={1} max={maxMines(draft.w, draft.h)} onChange={(n) => setSize({ n })} />
          </div>
        )}

        <Toggle
          label="No guessing"
          hint="Every board can be solved by logic alone, as in Tatham’s Mines."
          checked={draft.noGuess}
          onChange={(noGuess) => set({ noGuess })}
        />
        <Toggle
          label="Fit board to screen"
          hint="Turns wide boards sideways on tall screens."
          checked={draft.autoRotate}
          onChange={(autoRotate) => set({ autoRotate })}
        />
        {hapticsSupported() && (
          <Toggle label="Haptics" hint="Vibrate when flagging, winning and losing." checked={draft.haptics} onChange={(haptics) => set({ haptics })} />
        )}

        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Done
          </button>
        </div>

        <p className="about">
          Tap to reveal · long-press to flag · tap a number to clear around it.
          <br />
          After <a href="https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/mines.html">Mines</a> by Simon Tatham.
        </p>
      </form>
    </dialog>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => props.onChange(Number(text))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          props.onChange(Number(text));
        }}
      />
    </label>
  );
}

function Toggle(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {props.label}
        <small>{props.hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}
