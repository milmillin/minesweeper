import { memo, useRef, useState, type PointerEvent } from 'react';
import { FLAG, HIDDEN, type Game } from '../game/game';
import { neighbourTable } from '../game/grid';
import { FlagGlyph, MineGlyph } from './icons';

const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE = 10;

interface Props {
  game: Game;
  transposed: boolean;
  cellSize: number;
  onTap: (i: number) => void;
  onLongPress: (i: number) => void;
  onSecondary: (i: number) => void;
}

interface Press {
  id: number;
  i: number;
  x: number;
  y: number;
  timer: number;
  fired: boolean;
}

const cellIndex = (target: EventTarget | null): number => {
  const el = (target as HTMLElement | null)?.closest?.('[data-i]') as HTMLElement | null;
  return el ? Number(el.dataset.i) : -1;
};

export function Board({ game, transposed, cellSize, onTap, onLongPress, onSecondary }: Props) {
  const { w, h, cells, status, mines, hit } = game;
  const cols = transposed ? h : w;
  const rows = transposed ? w : h;
  const nb = neighbourTable(w, h);
  const press = useRef<Press | null>(null);
  /** Cell under the pointer; pressing a number presses its hidden neighbours. */
  const [pressed, setPressed] = useState(-1);
  const over = status === 'won' || status === 'lost';

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setPressed(-1);
  };

  const onPointerDown = (e: PointerEvent) => {
    const i = cellIndex(e.target);
    if (i < 0 || !e.isPrimary) return;
    if (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.shiftKey) && e.pointerType === 'mouse')) {
      onSecondary(i);
      return;
    }
    if (e.button !== 0) return;
    cancel();
    const p: Press = { id: e.pointerId, i, x: e.clientX, y: e.clientY, timer: 0, fired: false };
    if (e.pointerType !== 'mouse') {
      p.timer = window.setTimeout(() => {
        p.fired = true;
        setPressed(-1);
        onLongPress(i);
      }, LONG_PRESS_MS);
    }
    press.current = p;
    setPressed(i);
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.fired) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancel();
  };

  const onPointerUp = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const fired = p.fired;
    cancel();
    if (!fired) onTap(p.i);
  };

  const pressedSet = new Set<number>();
  if (pressed >= 0 && !over) {
    if (cells[pressed] === HIDDEN) pressedSet.add(pressed);
    else if (cells[pressed] > 0) for (const n of nb[pressed]) if (cells[n] === HIDDEN) pressedSet.add(n);
  }

  /** A number is in error when its flags can't be right: too many, or too few cells left to flag. */
  const conflicts = (i: number) => {
    const v = cells[i];
    if (v <= 0 || over) return false;
    let flags = 0;
    let hidden = 0;
    for (const n of nb[i]) {
      if (cells[n] === FLAG) flags++;
      else if (cells[n] === HIDDEN) hidden++;
    }
    return flags > v || flags + hidden < v;
  };

  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = transposed ? c * w + r : r * w + c;
      const v = cells[i];
      const isMine = !!mines?.[i];
      items.push(
        <Cell
          key={i}
          i={i}
          v={v}
          showMine={status === 'lost' && isMine && v === HIDDEN}
          wrongFlag={status === 'lost' && v === FLAG && !isMine}
          exploded={i === hit}
          pressed={pressedSet.has(i)}
          error={conflicts(i)}
        />,
      );
    }
  }

  return (
    <div
      className={`board ${status}`}
      role="grid"
      aria-label={`Minefield ${w} by ${h}`}
      style={{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`, ['--cell' as string]: `${cellSize}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={(e) => e.pointerType === 'mouse' && cancel()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items}
    </div>
  );
}

interface CellProps {
  i: number;
  v: number;
  showMine: boolean;
  wrongFlag: boolean;
  exploded: boolean;
  pressed: boolean;
  error: boolean;
}

const Cell = memo(function Cell({ i, v, showMine, wrongFlag, exploded, pressed, error }: CellProps) {
  let cls = 'cell';
  let content = null;
  let label: string;
  if (exploded) {
    cls += ' open exploded';
    content = <MineGlyph className="glyph" />;
    label = 'exploded mine';
  } else if (showMine) {
    cls += ' open mine';
    content = <MineGlyph className="glyph" />;
    label = 'mine';
  } else if (v === FLAG) {
    cls += wrongFlag ? ' flag wrong' : ' flag';
    content = <FlagGlyph className="glyph" />;
    label = wrongFlag ? 'wrong flag' : 'flagged';
  } else if (v === HIDDEN) {
    if (pressed) cls += ' pressed';
    label = 'hidden';
  } else {
    cls += ` open n${v}${error ? ' error' : ''}`;
    content = v > 0 ? v : null;
    label = v > 0 ? `${v}${error ? ', flags don’t match' : ''}` : 'empty';
  }
  return (
    <div className={cls} data-i={i} role="gridcell" aria-label={label}>
      {content}
    </div>
  );
});
