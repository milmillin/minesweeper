import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Board } from './components/Board';
import { BulbIcon, FlagGlyph, GearIcon, NewIcon, RedoIcon, RestartIcon, UndoIcon } from './components/icons';
import { SettingsSheet } from './components/SettingsSheet';
import { elapsed, FLAG, flagsPlaced, gameFromId, gameIds, HIDDEN, newGame, reducer, type Game } from './game/game';
import { findHint, type Hint } from './game/hint';
import { useNow } from './hooks/useNow';
import { haptic, setHapticsEnabled } from './lib/haptics';
import { load, save } from './lib/storage';
import { bestKey, DEFAULT_SETTINGS, sizeLabel, type Settings } from './settings';

const SETTINGS_KEY = 'mines.settings';
const GAME_KEY = 'mines.game';
const BEST_KEY = 'mines.best';

/** A game ID in the URL fragment, as on Tatham's pages: mines.html#9x9n10#123… */
function idFromUrl(): string | null {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? id : null;
}

function initialGame(settings: Settings): Game {
  const fromUrl = idFromUrl();
  if (fromUrl) {
    try {
      return gameFromId(fromUrl);
    } catch {
      /* fall through to the saved game */
    }
  }
  const fresh = newGame(settings);
  const saved = load<Game | null>(GAME_KEY, null as never);
  const valid =
    saved &&
    (saved.mines !== null || typeof saved.rstate === 'string') &&
    saved.w === settings.w &&
    saved.h === settings.h &&
    saved.n === settings.n &&
    Array.isArray(saved.cells) &&
    saved.cells.length === saved.w * saved.h &&
    Array.isArray(saved.past) &&
    Array.isArray(saved.future);
  return valid ? { ...fresh, ...saved } : fresh;
}

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => load(SETTINGS_KEY, DEFAULT_SETTINGS));
  const [game, dispatch] = useReducer(reducer, settings, initialGame);

  // A game loaded from the URL also sets the size for later games; then drop the fragment.
  useEffect(() => {
    if (!idFromUrl()) return;
    setSettings((s) => ({ ...s, w: game.w, h: game.h, n: game.n, noGuess: game.noGuess }));
    history.replaceState(null, '', location.pathname + location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [best, setBest] = useState<Record<string, number>>(() => load(BEST_KEY, {}));
  const [newBest, setNewBest] = useState(false);
  const [flagMode, setFlagMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);

  // A hint describes one position; any change to the board retires it.
  useEffect(() => setHint(null), [game.cells, game.status]);

  // Bring the hint's cells on screen; big boards scroll inside the stage.
  useEffect(() => {
    if (!hint) return;
    const els = [...hint.wrong, ...hint.mines, ...hint.safe, ...hint.sources]
      .map((i) => document.querySelector<HTMLElement>(`.board [data-i="${i}"]`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const tops = els.map((el) => el.getBoundingClientRect().top);
    // Last, so the cells to act on win if they can't all fit.
    els[tops.indexOf(Math.max(...tops))].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    els[tops.indexOf(Math.min(...tops))].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    els[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [hint]);

  const showHint = useCallback(() => {
    const h = findHint(game);
    setHint(h);
    if (h.safe.length || h.mines.length || h.wrong.length) dispatch({ type: 'hint' });
  }, [game]);
  const applyHint = useCallback(() => {
    if (!hint) return;
    if (hint.mines.length) haptic('flag');
    dispatch({ type: 'apply', safe: hint.safe, mines: hint.mines, unflag: game.status === 'playing' ? hint.wrong : [], now: Date.now() });
  }, [hint, game.status]);
  const now = useNow(game.status === 'playing' && game.since !== null);

  useEffect(() => setHapticsEnabled(settings.haptics), [settings.haptics]);
  useEffect(() => save(SETTINGS_KEY, settings), [settings]);
  useEffect(() => save(GAME_KEY, game), [game]);

  // Stop the clock while the app is in the background.
  useEffect(() => {
    dispatch({ type: 'resume', now: Date.now() });
    const onVis = () => dispatch({ type: document.hidden ? 'pause' : 'resume', now: Date.now() });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onVis);
    };
  }, []);

  // React to the game ending.
  const prevStatus = useRef(game.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = game.status;
    if (prev === game.status) return;
    if (game.status === 'lost') haptic('lose');
    if (game.status === 'won') {
      haptic('win');
      const key = bestKey(game);
      if (!game.hints && (!(key in best) || game.accum < best[key])) {
        const next = { ...best, [key]: game.accum };
        setBest(next);
        save(BEST_KEY, next);
        setNewBest(true);
      }
    } else setNewBest(false);
  }, [game, best]);

  // --- Board sizing ---------------------------------------------------------
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStage({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const fit = (cols: number, rows: number) => Math.floor(Math.min((stage.width - 8) / cols, (stage.height - 8) / rows));
  const normal = fit(game.w, game.h);
  const rotated = fit(game.h, game.w);
  const transposed = settings.autoRotate && game.w !== game.h && rotated > normal;
  const cellSize = Math.max(coarse ? 22 : 18, Math.min(60, transposed ? rotated : normal));

  // --- Input ----------------------------------------------------------------
  const cellsRef = useRef(game.cells);
  cellsRef.current = game.cells;
  const overRef = useRef(false);
  overRef.current = game.status === 'won' || game.status === 'lost';

  const flag = useCallback((i: number) => {
    const v = cellsRef.current[i];
    if (overRef.current || (v !== HIDDEN && v !== FLAG)) return;
    haptic('flag');
    dispatch({ type: 'flag', i });
  }, []);
  const reveal = useCallback((i: number) => dispatch({ type: 'reveal', i, now: Date.now() }), []);

  const onTap = useCallback(
    (i: number) => {
      const v = cellsRef.current[i];
      if (flagMode && (v === HIDDEN || v === FLAG)) flag(i);
      else reveal(i);
    },
    [flagMode, flag, reveal],
  );
  const onLongPress = useCallback(
    (i: number) => {
      if (flagMode) {
        if (cellsRef.current[i] === HIDDEN) {
          haptic('tap');
          reveal(i);
        }
      } else flag(i);
    },
    [flagMode, flag, reveal],
  );

  const startNew = useCallback((s: Settings) => dispatch({ type: 'new', config: s }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || (e.target as HTMLElement).closest('input')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((mod && k === 'z' && !e.shiftKey) || (!mod && k === 'u')) dispatch({ type: 'undo', now: Date.now() });
      else if ((mod && (k === 'y' || (k === 'z' && e.shiftKey))) || (!mod && k === 'r')) dispatch({ type: 'redo', now: Date.now() });
      else if (!mod && k === 'n') startNew(settings);
      else if (!mod && k === 'f') setFlagMode((f) => !f);
      else if (!mod && k === 'h') showHint();
      else if (k === 'escape') setHint(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, settings, startNew, showHint]);

  // --- Status ---------------------------------------------------------------
  const left = game.n - flagsPlaced(game);
  const time = elapsed(game, now);
  const record = best[bestKey(game)];
  let message: string;
  switch (game.status) {
    case 'ready':
      message = `${sizeLabel(game)} · tap to start`;
      break;
    case 'playing':
      message = `${sizeLabel(game)}${game.noGuess ? '' : ' · may need guessing'}`;
      break;
    case 'won':
      message = game.hints
        ? `Cleared with ${game.hints === 1 ? '1 hint' : `${game.hints} hints`}`
        : newBest
          ? 'Cleared — new best!'
          : `Cleared${record !== undefined ? ` · best ${formatTime(record)}` : ''}`;
      break;
    case 'lost':
      message = 'Boom. Undo to take that back.';
      break;
  }

  return (
    <div className={`app ${flagMode ? 'flag-mode' : ''}`}>
      <header className="hud">
        <div className="counter" aria-label={`${left} mines left`}>
          <FlagGlyph className="hud-flag" />
          <span>{left}</span>
        </div>
        <div className={`message ${game.status}`} role="status">
          {message}
        </div>
        <div className="timer" aria-label="Time">
          {formatTime(time)}
        </div>
      </header>

      <main className="stage" ref={stageRef}>
        {stage.width > 0 && (
          <div className="board-wrap">
            <Board game={game} hint={hint} transposed={transposed} cellSize={cellSize} onTap={onTap} onLongPress={onLongPress} onSecondary={flag} />
          </div>
        )}
      </main>

      {hint && (
        <div className="hint-bar" role="status">
          <p>{hint.text}</p>
          <div className="hint-actions">
            {game.status === 'playing' && (hint.safe.length > 0 || hint.mines.length > 0 || hint.wrong.length > 0) && (
              <button className="primary" onClick={applyHint}>
                {hint.wrong.length ? 'Remove flag' : hint.safe.length && hint.mines.length ? 'Apply' : hint.safe.length ? 'Open' : 'Flag'}
              </button>
            )}
            <button onClick={() => setHint(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <nav className="toolbar" aria-label="Game controls">
        <button onClick={() => dispatch({ type: 'undo', now: Date.now() })} disabled={!game.past.length} aria-label="Undo" title="Undo (U)">
          <UndoIcon />
        </button>
        <button onClick={() => dispatch({ type: 'redo', now: Date.now() })} disabled={!game.future.length} aria-label="Redo" title="Redo (R)">
          <RedoIcon />
        </button>
        <button
          className="mode"
          aria-pressed={flagMode}
          onClick={() => setFlagMode((f) => !f)}
          title="Flag mode (F): taps place flags"
        >
          <FlagGlyph className="mode-flag" />
          <span>{flagMode ? 'Flagging' : 'Flag mode'}</span>
        </button>
        <button onClick={hint ? () => setHint(null) : showHint} aria-pressed={!!hint} aria-label="Hint" title="Hint (H)">
          <BulbIcon />
        </button>
        <button onClick={() => dispatch({ type: 'restart' })} disabled={!game.mines} aria-label="Restart this board" title="Restart this board">
          <RestartIcon />
        </button>
        <button onClick={() => startNew(settings)} aria-label="New game" title="New game (N)">
          <NewIcon />
        </button>
        <button onClick={() => setSheetOpen(true)} aria-label="Settings" title="Settings">
          <GearIcon />
        </button>
      </nav>

      <SettingsSheet
        open={sheetOpen}
        settings={settings}
        ids={gameIds(game)}
        onClose={() => setSheetOpen(false)}
        onLoadId={(id) => {
          try {
            const g = gameFromId(id);
            dispatch({ type: 'load', game: g });
            setSettings((s) => ({ ...s, w: g.w, h: g.h, n: g.n, noGuess: g.noGuess }));
            setSheetOpen(false);
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : 'Invalid game ID';
          }
        }}
        onApply={(s, restart) => {
          setSettings(s);
          setSheetOpen(false);
          if (restart) startNew(s);
        }}
      />
    </div>
  );
}
