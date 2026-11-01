import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Appointment, Client, Stylist } from '../lib/types';
import { layoutLanes, overlaps } from '../lib/overlap';
import { minToTime } from '../lib/dates';
import { serviceStyle } from '../lib/services';
import { clientLabel } from '../data/hooks';

export const SLOT = 15;
export const PX_PER_MIN = 22 / 15; // 22px pentru 15 minute

export interface GridColumn {
  key: string;
  date: string;
  stylistId: string | null; // null = coloană de zi (săptămânal), toate stilistele
  header: ReactNode;
  appointments: Appointment[];
  past: boolean;
  today: boolean;
}

export interface MoveTarget {
  date: string;
  stylist_id: string;
  start_min: number;
}

interface Props {
  columns: GridColumn[];
  range: { start: number; end: number };
  nowMin: number;
  clients: Map<string, Client>;
  stylists: Map<string, Stylist>;
  pending: Set<string>;
  showStylist: boolean;
  colMinWidth: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onCreate: (date: string, stylistId: string | null, startMin: number) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, to: MoveTarget) => void;
}

interface DragState {
  appt: Appointment;
  pointerType: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  grabMin: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: { move: (e: PointerEvent) => void; up: () => void; cancel: () => void };
}

export function TimeGrid(props: Props) {
  const { columns, range, nowMin, clients, stylists, pending, showStylist, colMinWidth, scrollRef } = props;
  const height = (range.end - range.start) * PX_PER_MIN;
  const drag = useRef<DragState | null>(null);
  const [ghost, setGhost] = useState<(MoveTarget & { id: string; colKey: string }) | null>(null);
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const suppressClick = useRef(0);
  const [hover, setHover] = useState<{ colKey: string; min: number } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // pe iPhone/iPad: în timpul mutării, oprim derularea paginii
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (drag.current?.active) e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  const slots = useMemo(() => {
    const out: { min: number; kind: 'hour' | 'half' | 'q' }[] = [];
    for (let m = range.start; m < range.end; m += SLOT) {
      out.push({ min: m, kind: m % 60 === 0 ? 'hour' : m % 30 === 0 ? 'half' : 'q' });
    }
    return out;
  }, [range.start, range.end]);

  const yToMin = (col: HTMLElement, clientY: number) => {
    const rect = col.getBoundingClientRect();
    return range.start + (clientY - rect.top) / PX_PER_MIN;
  };

  function updateGhost(x: number, y: number) {
    const d = drag.current;
    if (!d) return;
    const el = document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).dataset?.colKey) as HTMLElement | undefined;
    if (!el) return;
    const col = propsRef.current.columns.find((c) => c.key === el.dataset.colKey);
    if (!col) return;
    let m = Math.round((yToMin(el, y) - d.grabMin) / SLOT) * SLOT;
    m = Math.max(0, Math.min(1440 - d.appt.duration_min, m));
    setGhost({ id: d.appt.id, colKey: col.key, date: col.date, stylist_id: col.stylistId ?? d.appt.stylist_id, start_min: m });
    // derulare automată la margini
    const sc = scrollRef.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (y < r.top + 60) sc.scrollBy(0, -14);
      else if (y > r.bottom - 60) sc.scrollBy(0, 14);
      if (x < r.left + 40) sc.scrollBy(-14, 0);
      else if (x > r.right - 40) sc.scrollBy(14, 0);
    }
  }

  function endDrag(commit: boolean) {
    const d = drag.current;
    if (!d) return;
    window.removeEventListener('pointermove', d.listeners.move);
    window.removeEventListener('pointerup', d.listeners.up);
    window.removeEventListener('pointercancel', d.listeners.cancel);
    if (d.timer) clearTimeout(d.timer);
    drag.current = null;
    const g = ghostRef.current;
    setGhost(null);
    if (d.active) {
      suppressClick.current = Date.now() + 400;
      if (commit && g && (g.date !== d.appt.date || g.start_min !== d.appt.start_min || g.stylist_id !== d.appt.stylist_id)) {
        propsRef.current.onMove(d.appt.id, { date: g.date, start_min: g.start_min, stylist_id: g.stylist_id });
      }
    } else if (commit) {
      suppressClick.current = Date.now() + 400;
      propsRef.current.onOpen(d.appt.id);
    }
  }

  function activate() {
    const d = drag.current;
    if (!d) return;
    d.active = true;
    setHover(null);
    navigator.vibrate?.(12);
    updateGhost(d.lastX, d.lastY);
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (!d.active) {
      if (d.pointerType === 'mouse' || d.pointerType === 'pen') {
        if (dist > 6) activate();
      } else if (dist > 10) {
        // degetul derulează pagina => nu este o mutare
        endDrag(false);
      }
      return;
    }
    updateGhost(e.clientX, e.clientY);
  }
  function onPointerUp() {
    endDrag(true);
  }
  function onPointerCancel() {
    endDrag(false);
  }

  function onBlockPointerDown(e: React.PointerEvent, a: Appointment) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    if (e.pointerType === 'mouse') e.preventDefault(); // fără selecție de text la tragere
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = {
      appt: a,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      grabMin: (e.clientY - rect.top) / PX_PER_MIN,
      active: false,
      timer: null,
      listeners: { move: onPointerMove, up: onPointerUp, cancel: onPointerCancel },
    };
    if (e.pointerType === 'touch') drag.current.timer = setTimeout(activate, 380); // apăsare lungă
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onColumnClick(e: React.MouseEvent, col: GridColumn) {
    if (Date.now() < suppressClick.current) return;
    const m = Math.floor(yToMin(e.currentTarget as HTMLElement, e.clientY) / SLOT) * SLOT;
    props.onCreate(col.date, col.stylistId, Math.max(0, Math.min(1440 - SLOT, m)));
  }

  function onColumnHover(e: React.PointerEvent, col: GridColumn) {
    if (e.pointerType !== 'mouse' || drag.current) return;
    if ((e.target as HTMLElement).closest('.appt')) {
      if (hover) setHover(null);
      return;
    }
    const m = Math.floor(yToMin(e.currentTarget as HTMLElement, e.clientY) / SLOT) * SLOT;
    if (!hover || hover.colKey !== col.key || hover.min !== m) setHover({ colKey: col.key, min: m });
  }

  const gridCols = `56px repeat(${columns.length}, minmax(${colMinWidth}px, 1fr))`;
  const minWidth = 56 + columns.length * colMinWidth;

  function renderBlock(a: Appointment, lane: { lane: number; lanes: number }, conflicting: boolean, ghostMode = false, at?: number) {
    const start = at ?? a.start_min;
    const top = (start - range.start) * PX_PER_MIN;
    const h = Math.max(a.duration_min * PX_PER_MIN - 2, 18);
    const st = serviceStyle(a.service);
    const stylist = stylists.get(a.stylist_id);
    const { name, phone } = clientLabel(a, clients);
    const compact = h < 44;
    const w = 100 / lane.lanes;
    const isDragging = ghost?.id === a.id && !ghostMode;
    const end = start + a.duration_min;
    return (
      <div
        key={ghostMode ? `ghost-${a.id}` : a.id}
        className={[
          'appt', compact && 'compact', conflicting && 'overlap', pending.has(`appointments:${a.id}`) && 'pending',
          isDragging && 'dragging', ghostMode && 'ghost',
        ].filter(Boolean).join(' ')}
        style={{
          top: top + 1,
          height: h,
          left: `calc(${lane.lane * w}% + 3px)`,
          width: `calc(${w}% - 6px)`,
          background: st.color,
          borderLeftColor: showStylist ? stylist?.color ?? st.ink : st.ink,
        }}
        role="button"
        tabIndex={0}
        title={`${minToTime(start)}–${minToTime(end)} · ${name} · ${a.service}${a.notes ? '\n' + a.notes : ''}`}
        onPointerDown={ghostMode ? undefined : (e) => onBlockPointerDown(e, a)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Enter' && props.onOpen(a.id)}
      >
        {compact ? (
          <div className="line1">
            <span className="t">{minToTime(start)}</span>
            <span className="n" style={{ fontSize: 12.5 }}>{conflicting && <span className="warn-ico">⚠ </span>}{name}</span>
            <span className="s">{a.service}</span>
          </div>
        ) : (
          <>
            <div className="t">
              {conflicting && <span className="warn-ico">⚠ </span>}
              {minToTime(start)} – {minToTime(end)}
              {showStylist && stylist ? ` · ${stylist.name}` : ''}
            </div>
            <div className="n">{name}</div>
            {h > 60 && <div className="s">{a.service || '—'}</div>}
            {h > 80 && phone && <div className="s tiny">☎ {phone}</div>}
            {h > 100 && a.notes && <div className="s tiny">“{a.notes}”</div>}
            {h > 76 && a.updated_by_name && <div className="by">✎ {a.updated_by_name}</div>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid-wrap" style={{ minWidth }}>
      <div className="grid-head" style={{ gridTemplateColumns: gridCols }}>
        <div className="col-h" />
        {columns.map((c) => (
          <div key={c.key} className={`col-h ${c.today ? 'today' : ''}`}>{c.header}</div>
        ))}
      </div>
      <div className="grid-body" style={{ gridTemplateColumns: gridCols, height }}>
        <div className="time-col">
          {slots.filter((s) => s.kind !== 'q').map((s) => (
            <div key={s.min} className="time-label" style={{ top: (s.min - range.start) * PX_PER_MIN, fontWeight: s.kind === 'hour' ? 600 : 400, opacity: s.kind === 'hour' ? 1 : 0.7 }}>
              {s.min === range.start ? '' : minToTime(s.min)}
            </div>
          ))}
        </div>
        {columns.map((col) => {
          const lanes = layoutLanes(col.appointments);
          const conflicting = new Set<string>();
          for (const a of col.appointments) for (const b of col.appointments) if (overlaps(a, b)) conflicting.add(a.id);
          const ghostHere = ghost && ghost.colKey === col.key ? ghost : null;
          const dragged = ghostHere ? drag.current?.appt : null;
          return (
            <div
              key={col.key}
              data-col-key={col.key}
              className={`day-col ${col.past ? 'past' : ''} ${ghostHere ? 'drop-target' : ''}`}
              onClick={(e) => onColumnClick(e, col)}
              onPointerMove={(e) => onColumnHover(e, col)}
              onPointerLeave={() => setHover(null)}
            >
              {slots.map((s) => (
                <div key={s.min} className={`slot-line ${s.kind}`} style={{ top: (s.min - range.start) * PX_PER_MIN }} />
              ))}
              {col.today && nowMin >= range.start && nowMin <= range.end && (
                <div className="now-line" style={{ top: (nowMin - range.start) * PX_PER_MIN }} />
              )}
              {hover && hover.colKey === col.key && (
                <div className="hover-slot" style={{ top: (hover.min - range.start) * PX_PER_MIN + 1, height: 30 * PX_PER_MIN - 2 }}>
                  + {minToTime(hover.min)}
                </div>
              )}
              {col.appointments.map((a) => renderBlock(a, lanes.get(a.id) ?? { lane: 0, lanes: 1 }, conflicting.has(a.id)))}
              {ghostHere && dragged && renderBlock({ ...dragged, stylist_id: ghostHere.stylist_id }, { lane: 0, lanes: 1 }, false, true, ghostHere.start_min)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
