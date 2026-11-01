import { useEffect, useMemo, useRef } from 'react';
import { useNav, type CalView } from '../components/nav';
import { TimeGrid, type GridColumn, type MoveTarget } from '../components/TimeGrid';
import { useAppointmentsRange, useClientsMap, useNow, usePendingKeys, useStylists, clientLabel } from '../data/hooks';
import {
  addDays, addMonths, addYears, formatLong, formatMonthYear, formatWeekRange, fromISO, minToTime,
  monthGrid, sameMonth, weekDays, ZILE_SCURT, formatShort,
} from '../lib/dates';
import { serviceStyle } from '../lib/services';
import { db, useAuth, useUser } from '../auth/AuthContext';
import { moveAppointment, overlapsFor } from '../data/repo';
import { useFeedback } from '../components/ui';
import type { Appointment } from '../lib/types';

const DAY_START = 8 * 60;
const DAY_END = 20 * 60;

function rangeFor(appts: Appointment[]) {
  let start = DAY_START;
  let end = DAY_END;
  for (const a of appts) {
    start = Math.min(start, Math.floor(a.start_min / 60) * 60);
    end = Math.max(end, Math.min(1440, Math.ceil((a.start_min + a.duration_min) / 60) * 60));
  }
  return { start, end };
}

function relLabel(date: string, today: string) {
  if (date === today) return 'Astăzi';
  if (date === addDays(today, 1)) return 'Mâine';
  if (date === addDays(today, -1)) return 'Ieri';
  return date < today ? 'Din trecut' : 'Viitor';
}

export function CalendarPage() {
  const nav = useNav();
  const { calDate: date, calView: view } = nav;
  const { profile } = useAuth();
  const user = useUser();
  const { confirm, toast } = useFeedback();
  const now = useNow();
  const stylists = useStylists();
  const stylistMap = useMemo(() => new Map(stylists.map((s) => [s.id, s])), [stylists]);
  const clients = useClientsMap();
  const pending = usePendingKeys();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [from, to] = useMemo(() => {
    if (view === 'day') return [date, date];
    if (view === 'week') {
      const d = weekDays(date);
      return [d[0], d[6]];
    }
    const g = monthGrid(date);
    return [g[0], g[41]];
  }, [date, view]);
  const appts = useAppointmentsRange(from, to);

  // trecerea la ziua următoare: dacă eram pe "Astăzi", urmăm data reală
  const lastToday = useRef(now.today);
  useEffect(() => {
    if (lastToday.current !== now.today) {
      if (date === lastToday.current) nav.setCalDate(now.today);
      lastToday.current = now.today;
    }
  }, [now.today]); // eslint-disable-line react-hooks/exhaustive-deps

  // la deschiderea zilei de azi, derulăm la ora curentă
  useEffect(() => {
    if (view === 'month' || !scrollRef.current) return;
    // pentru ziua de azi: dacă ora curentă nu se vede, o aducem în mijlocul ecranului
    const el = scrollRef.current;
    const nowY = (now.minutes - DAY_START) * (22 / 15) + 70;
    el.scrollTop = date === now.today && nowY > el.clientHeight - 80 ? nowY - el.clientHeight / 2 : 0;
  }, [date, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // scurtături de tastatură pe MacBook
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't' || e.key === 'T') nav.goToday();
      else if (e.key === 'n' || e.key === 'N') nav.openNew({ date });
      else if (e.key === 'z') nav.setCalView('day');
      else if (e.key === 's') nav.setCalView('week');
      else if (e.key === 'l') nav.setCalView('month');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function step(dir: number) {
    if (view === 'day') nav.setCalDate(addDays(date, dir));
    else if (view === 'week') nav.setCalDate(addDays(date, dir * 7));
    else nav.setCalDate(addMonths(date, dir));
  }

  const defaultStylist = profile?.stylist_id && stylistMap.has(profile.stylist_id) ? profile.stylist_id : stylists[0]?.id;

  async function handleMove(id: string, to: MoveTarget) {
    const a = await db.appointments.get(id);
    if (!a) return;
    const clash = await overlapsFor(db, { ...to, id, duration_min: a.duration_min });
    const stylistName = stylistMap.get(to.stylist_id)?.name ?? to.stylist_id;
    const ok = await confirm(
      <>
        <p style={{ marginTop: 0 }}>
          Mutați programarea <b>{clientLabel(a, clients).name}</b> pe <b>{formatLong(to.date)}</b>, ora{' '}
          <b>{minToTime(to.start_min)}</b>, la <b>{stylistName}</b>?
        </p>
        {clash.length > 0 && (
          <div className="notice danger">
            ⚠ Atenție: se suprapune cu {clash.map((c) => `${minToTime(c.start_min)} ${clientLabel(c, clients).name}`).join(', ')}.
          </div>
        )}
      </>,
      { title: 'Mutare programare', ok: clash.length ? 'Mută oricum' : 'Mută', danger: clash.length > 0 },
    );
    if (!ok) return;
    const before = { date: a.date, start_min: a.start_min, stylist_id: a.stylist_id };
    await moveAppointment(db, id, to, user);
    toast('Programare mutată', {
      label: 'Anulează',
      run: () => void moveAppointment(db, id, before, user),
    });
  }

  const columns: GridColumn[] = useMemo(() => {
    if (view === 'day') {
      const dayAppts = appts.filter((a) => a.date === date);
      const extra = [...new Set(dayAppts.map((a) => a.stylist_id))].filter((id) => !stylistMap.has(id));
      const cols = [...stylists.map((s) => ({ id: s.id, name: s.name, color: s.color })), ...extra.map((id) => ({ id, name: id, color: '#ccc' }))];
      return cols.map((s) => {
        const list = dayAppts.filter((a) => a.stylist_id === s.id);
        return {
          key: `${date}|${s.id}`,
          date,
          stylistId: s.id,
          past: date < now.today,
          today: false,
          appointments: list,
          header: (
            <div>
              <div className="stylist-name"><span className="stylist-dot" style={{ background: s.color }} />{s.name}</div>
              <div className="tiny muted">{list.length === 0 ? 'liber' : list.length === 1 ? '1 programare' : `${list.length} programări`}</div>
            </div>
          ),
        };
      });
    }
    if (view === 'week') {
      return weekDays(date).map((d, i) => {
        const dt = fromISO(d);
        return {
          key: d,
          date: d,
          stylistId: null,
          past: d < now.today,
          today: d === now.today,
          appointments: appts.filter((a) => a.date === d),
          header: (
            <button onClick={() => { nav.setCalDate(d); nav.setCalView('day'); }} title="Deschide ziua">
              <div className="wd">{ZILE_SCURT[(i + 1) % 7]}</div>
              <div className="dn">{dt.getDate()}</div>
            </button>
          ),
        };
      });
    }
    return [];
  }, [view, date, appts, stylists, stylistMap, now.today, nav]);

  const range = useMemo(() => rangeFor(columns.flatMap((c) => c.appointments)), [columns]);

  const title =
    view === 'day' ? (
      <><small>{relLabel(date, now.today)}</small>{formatLong(date)}</>
    ) : view === 'week' ? (
      <><small>Săptămâna</small>{formatWeekRange(date)}</>
    ) : (
      <><small>Luna</small>{formatMonthYear(date)}</>
    );

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="cal-title">{title}</div>
        <div className="cal-nav">
          {view === 'month' && (
            <button className="icon-btn" onClick={() => nav.setCalDate(addYears(date, -1))} title="Anul anterior" aria-label="Anul anterior">«</button>
          )}
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Înapoi" title="Înapoi (←)">‹</button>
          <button className="btn" onClick={nav.goToday} title="Astăzi (T)">Astăzi</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Înainte" title="Înainte (→)">›</button>
          {view === 'month' && (
            <button className="icon-btn" onClick={() => nav.setCalDate(addYears(date, 1))} title="Anul următor" aria-label="Anul următor">»</button>
          )}
          <label className="icon-btn date-jump" title="Alege o dată (orice zi, lună, an)">
            📅
            <input type="date" value={date} onChange={(e) => e.target.value && nav.setCalDate(e.target.value)} aria-label="Alege data" />
          </label>
        </div>
        <div className="seg" role="tablist">
          {(['day', 'week', 'month'] as CalView[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => nav.setCalView(v)}>
              {v === 'day' ? 'Zi' : v === 'week' ? <><span className="desk-only">Săptămână</span><span className="mobile-only">Săpt.</span></> : 'Lună'}
            </button>
          ))}
        </div>
        <button className="btn gold desk-only" onClick={() => nav.openNew({ date })}>＋ Programare nouă</button>
      </div>

      <div className="cal-body" ref={scrollRef}>
        {view === 'month' ? (
          <MonthView date={date} today={now.today} appts={appts} onPick={(d) => { nav.setCalDate(d); nav.setCalView('day'); }} />
        ) : (
          <TimeGrid
            columns={columns}
            range={range}
            nowMin={now.minutes}
            clients={clients}
            stylists={stylistMap}
            pending={pending}
            showStylist={view === 'week'}
            colMinWidth={view === 'week' ? 104 : 150}
            scrollRef={scrollRef}
            onCreate={(d, sid, m) => nav.openNew({ date: d, start_min: m, stylist_id: sid ?? defaultStylist })}
            onOpen={nav.openEdit}
            onMove={handleMove}
          />
        )}
        {view !== 'month' && (
          <p className="tiny muted" style={{ textAlign: 'center', marginTop: 10 }}>
            Apăsați pe un interval liber pentru o programare nouă · Trageți o programare pentru a o muta
            (pe telefon: țineți apăsat, apoi trageți)
          </p>
        )}
      </div>
    </div>
  );
}

function MonthView({ date, today, appts, onPick }: { date: string; today: string; appts: Appointment[]; onPick: (d: string) => void }) {
  const clients = useClientsMap();
  const days = monthGrid(date);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appts) {
      const l = m.get(a.date) ?? [];
      l.push(a);
      m.set(a.date, l);
    }
    for (const l of m.values()) l.sort((a, b) => a.start_min - b.start_min);
    return m;
  }, [appts]);
  return (
    <div className="month">
      <div className="month-head">
        {['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'].map((d) => (
          <div key={d}><span className="desk-only">{d}</span><span className="mobile-only">{d.slice(0, 3)}</span></div>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const dt = fromISO(d);
          return (
            <button
              key={d}
              className={`mcell ${sameMonth(d, date) ? '' : 'other'} ${d === today ? 'today' : ''}`}
              onClick={() => onPick(d)}
              title={formatShort(d)}
            >
              <div className="mnum">
                <span>{dt.getDate()}</span>
                {list.length > 0 && <span className="mcount">{list.length}</span>}
              </div>
              {list.slice(0, 3).map((a) => {
                const st = serviceStyle(a.service);
                return (
                  <div key={a.id} className="mchip" style={{ background: st.color, borderLeftColor: st.ink }}>
                    {minToTime(a.start_min)} {clientLabel(a, clients).name}
                  </div>
                );
              })}
              {list.length > 3 && <div className="mmore desk-only">+{list.length - 3} altele</div>}
              <div className="mdots">
                {list.slice(0, 6).map((a) => <i key={a.id} style={{ background: serviceStyle(a.service).ink }} />)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
