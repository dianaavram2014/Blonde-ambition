import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal, useFeedback } from './ui';
import { db, useUser } from '../auth/AuthContext';
import { useStylists, clientLabel, useClientsMap } from '../data/hooks';
import {
  deleteAppointment, overlapsFor, restoreAppointment, revertToSnapshot, saveAppointment, type AppointmentInput,
} from '../data/repo';
import { DURATIONS, SERVICES, normalize, normalizePhone, splitServices } from '../lib/services';
import { formatDateTime, formatDuration, formatLong, isValidISODate, minToTime, todayISO } from '../lib/dates';
import type { Appointment, Client, HistoryEntry } from '../lib/types';
import type { NewPrefill } from './nav';

const TIME_OPTIONS = Array.from({ length: (23 - 6) * 4 }, (_, i) => 6 * 60 + i * 15); // 06:00 – 22:45

interface Props {
  appointmentId: string | null;
  prefill?: NewPrefill;
  defaultStylist?: string;
  onClose: () => void;
  onOpenClient: (id: string) => void;
  onShowConflicts: () => void;
}

export function AppointmentDialog({ appointmentId, prefill, defaultStylist, onClose, onOpenClient, onShowConflicts }: Props) {
  const user = useUser();
  const stylists = useStylists();
  const clientsMap = useClientsMap();
  const { confirm, toast } = useFeedback();
  const existing = useLiveQuery(
    async () => (appointmentId ? (await db.appointments.get(appointmentId)) ?? null : null),
    [appointmentId],
  );
  const conflict = useLiveQuery(() => (appointmentId ? db.conflicts.get(`appointments:${appointmentId}`) : undefined), [appointmentId]);
  const loaded = existing !== undefined;

  const [form, setForm] = useState<AppointmentInput | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [customService, setCustomService] = useState('');
  const [customDuration, setCustomDuration] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // inițializare formular
  useEffect(() => {
    if (form || !loaded) return;
    if (appointmentId && !existing) return; // inexistentă
    if (existing) {
      const { name, phone } = clientLabel(existing, clientsMap);
      setForm({
        id: existing.id, client_id: existing.client_id, client_name: name, client_phone: phone,
        stylist_id: existing.stylist_id, date: existing.date, start_min: existing.start_min,
        duration_min: existing.duration_min, service: existing.service, notes: existing.notes,
      });
      const parts = splitServices(existing.service);
      const known = parts.filter((p) => SERVICES.some((s) => normalize(s.label) === normalize(p)));
      setServices(known.map((p) => SERVICES.find((s) => normalize(s.label) === normalize(p))!.label));
      setCustomService(parts.filter((p) => !known.includes(p)).join(', '));
      setCustomDuration(!DURATIONS.includes(existing.duration_min));
    } else {
      let client: Client | undefined;
      if (prefill?.client_id) client = clientsMap.get(prefill.client_id);
      setForm({
        client_id: client?.id ?? null, client_name: client?.name ?? '', client_phone: client?.phone ?? '',
        stylist_id: prefill?.stylist_id ?? defaultStylist ?? stylists[0]?.id ?? 'diana',
        date: prefill?.date ?? todayISO(), start_min: prefill?.start_min ?? 10 * 60, duration_min: 60,
        service: '', notes: '',
      });
    }
  }, [loaded, existing, clientsMap, form, prefill, defaultStylist, stylists, appointmentId]);

  const serviceText = useMemo(
    () => [...services, ...splitServices(customService)].join(', '),
    [services, customService],
  );

  const overlapsList = useLiveQuery(
    async () => (form && isValidISODate(form.date) ? overlapsFor(db, { ...form, id: form.id }) : []),
    [form?.date, form?.start_min, form?.duration_min, form?.stylist_id, form?.id],
  ) ?? [];

  if (!form) {
    return (
      <Modal title="Programare" onClose={onClose}>
        <div className="empty">{loaded ? 'Programarea nu a fost găsită.' : 'Se încarcă…'}</div>
      </Modal>
    );
  }

  const set = (patch: Partial<AppointmentInput>) => {
    setForm((f) => ({ ...f!, ...patch }));
    setError(null);
  };
  const end = form.start_min + form.duration_min;
  const isNew = !existing;
  const isPast = form.date < todayISO();

  async function save() {
    if (!form) return;
    const input = { ...form, service: serviceText };
    if (!input.client_name.trim()) return setError('Completați numele clientei.');
    if (!isValidISODate(input.date)) return setError('Alegeți o dată validă.');
    if (overlapsList.length) {
      const ok = await confirm(
        <>
          <p style={{ marginTop: 0 }}>Există deja o programare în acest interval pentru <b>{stylists.find((s) => s.id === form.stylist_id)?.name}</b>:</p>
          <ul>{overlapsList.map((o) => <li key={o.id}>{minToTime(o.start_min)}–{minToTime(o.start_min + o.duration_min)} · {clientLabel(o, clientsMap).name}</li>)}</ul>
          <p>Salvați totuși?</p>
        </>,
        { title: '⚠ Suprapunere', ok: 'Salvează oricum', danger: true },
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await saveAppointment(db, input, user);
      toast(isNew ? 'Programare salvată' : 'Modificări salvate');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm(
      <p style={{ margin: 0 }}>
        Ștergeți programarea <b>{form!.client_name}</b> din <b>{formatLong(existing.date)}</b>, ora <b>{minToTime(existing.start_min)}</b>?
        <br /><span className="small muted">O puteți recupera oricând din „Istoric → Programări șterse”.</span>
      </p>,
      { title: 'Ștergere programare', ok: 'Șterge', danger: true },
    );
    if (!ok) return;
    await deleteAppointment(db, existing.id, user);
    toast('Programare ștearsă', { label: 'Anulează', run: () => void restoreAppointment(db, existing.id, user) });
    onClose();
  }

  async function restore() {
    if (!existing) return;
    await restoreAppointment(db, existing.id, user);
    toast('Programare recuperată');
  }

  return (
    <Modal
      title={isNew ? 'Programare nouă' : existing?.deleted ? 'Programare ștearsă' : 'Programare'}
      onClose={onClose}
      footer={
        <>
          {error && <div className="notice danger">{error}</div>}
          {existing?.deleted ? (
            <button className="btn big gold" onClick={restore}>↺ Recuperează programarea</button>
          ) : (
            <button className="btn big primary" onClick={save} disabled={saving}>
              {saving ? 'Se salvează…' : 'Salvează programarea'}
            </button>
          )}
          {!isNew && !existing?.deleted && (
            <div className="row">
              <button className="btn danger" onClick={remove}>Șterge</button>
              <button className="btn" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Ascunde istoricul' : 'Istoric modificări'}</button>
            </div>
          )}
        </>
      }
    >
      {conflict && (
        <div className="notice danger">
          ⚠ Această programare are un conflict de sincronizare (a fost modificată și pe alt dispozitiv).{' '}
          <button className="btn sm" onClick={onShowConflicts}>Rezolvă conflictul</button>
        </div>
      )}
      {isPast && !isNew && !existing?.deleted && (
        <div className="notice info small">Programare din trecut – poate fi modificată în continuare.</div>
      )}

      <ClientPicker
        name={form.client_name}
        phone={form.client_phone}
        clientId={form.client_id}
        onChange={(p) => set(p)}
        onOpenClient={onOpenClient}
      />

      <div className="row">
        <label className="field">
          <span>Data</span>
          <input className="input" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required />
        </label>
        <label className="field">
          <span>Ora început</span>
          <select className="input" value={form.start_min} onChange={(e) => set({ start_min: Number(e.target.value) })}>
            {(TIME_OPTIONS.includes(form.start_min) ? TIME_OPTIONS : [...TIME_OPTIONS, form.start_min].sort((a, b) => a - b)).map((m) => (
              <option key={m} value={m}>{minToTime(m)}</option>
            ))}
          </select>
        </label>
      </div>
      {isValidISODate(form.date) && <div className="meta-line" style={{ marginTop: -8 }}>{formatLong(form.date)}</div>}

      <div className="field">
        <span>Durata</span>
        <div className="chips">
          {DURATIONS.map((d) => (
            <button key={d} type="button" className={`chip ${!customDuration && form.duration_min === d ? 'on' : ''}`}
              onClick={() => { setCustomDuration(false); set({ duration_min: d }); }}>
              {formatDuration(d)}
            </button>
          ))}
          <button type="button" className={`chip ${customDuration ? 'on' : ''}`} onClick={() => setCustomDuration(true)}>Altă durată</button>
        </div>
        {customDuration && (
          <div className="row" style={{ marginTop: 8 }}>
            <label className="field">
              <span>Minute</span>
              <input className="input" type="number" inputMode="numeric" min={5} max={1440} step={5} value={form.duration_min}
                onChange={(e) => set({ duration_min: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="field">
              <span>Ora final</span>
              <select className="input" value={end} onChange={(e) => set({ duration_min: Number(e.target.value) - form.start_min })}>
                {Array.from({ length: 96 }, (_, i) => form.start_min + (i + 1) * 15).filter((m) => m <= 1440).concat(TIME_OPTIONS.includes(end) || end % 15 === 0 ? [] : [end]).sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>{minToTime(m)}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="meta-line">
          {minToTime(form.start_min)} – {minToTime(end)} ({formatDuration(form.duration_min)})
        </div>
      </div>

      <div className="field">
        <span>Stilista</span>
        <div className="chips">
          {stylists.map((s) => (
            <button key={s.id} type="button" className={`chip ${form.stylist_id === s.id ? 'on' : ''}`} onClick={() => set({ stylist_id: s.id })}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: s.color, marginRight: 6 }} />
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {overlapsList.length > 0 && (
        <div className="notice warn">
          ⚠ Interval ocupat: {overlapsList.map((o) => `${minToTime(o.start_min)}–${minToTime(o.start_min + o.duration_min)} ${clientLabel(o, clientsMap).name}`).join(', ')}
        </div>
      )}

      <div className="field">
        <span>Serviciu</span>
        <div className="chips">
          {SERVICES.map((s) => {
            const on = services.includes(s.label);
            return (
              <button key={s.id} type="button" className={`chip ${on ? 'on' : ''}`}
                style={on ? undefined : { background: s.color, borderColor: 'transparent' }}
                onClick={() => setServices((l) => (on ? l.filter((x) => x !== s.label) : [...l, s.label]))}>
                {s.label}
              </button>
            );
          })}
        </div>
        <input className="input" placeholder="Alt serviciu (ex.: Keratină, Ombre…)" value={customService} onChange={(e) => setCustomService(e.target.value)} />
      </div>

      <label className="field">
        <span>Observații</span>
        <textarea className="input" value={form.notes} placeholder="Formula de culoare, preferințe, alergii…" onChange={(e) => set({ notes: e.target.value })} />
      </label>

      {existing && (
        <div className="meta-line">
          Creată de <b>{existing.created_by_name ?? '—'}</b> {existing.created_at && `· ${formatDateTime(existing.created_at)}`}
          <br />
          Ultima modificare: <b>{existing.updated_by_name ?? '—'}</b> {existing.updated_at && `· ${formatDateTime(existing.updated_at)}`}
          {existing.version === 0 && <> · <span className="tag pending">nesincronizată</span></>}
        </div>
      )}

      {showHistory && existing && <AppointmentHistory appointment={existing} />}
    </Modal>
  );
}

// ----------------------------------------------------------- ClientPicker
function ClientPicker({ name, phone, clientId, onChange, onOpenClient }: {
  name: string;
  phone: string;
  clientId: string | null;
  onChange: (p: { client_name?: string; client_phone?: string; client_id?: string | null }) => void;
  onOpenClient: (id: string) => void;
}) {
  const clients = useLiveQuery(() => db.clients.filter((c) => !c.deleted).toArray(), []) ?? [];
  const [focus, setFocus] = useState<'name' | 'phone' | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const q = focus === 'phone' ? normalizePhone(phone) : normalize(name);
  const matches = useMemo(() => {
    if (!focus || q.length < 2) return [];
    return clients
      .filter((c) => c.id !== clientId)
      .filter((c) => (focus === 'phone' ? normalizePhone(c.phone).includes(q) : normalize(c.name).includes(q)))
      .slice(0, 6);
  }, [clients, q, focus, clientId]);
  const linked = clientId ? clients.find((c) => c.id === clientId) : undefined;

  const pick = (c: Client) => {
    onChange({ client_id: c.id, client_name: c.name, client_phone: c.phone });
    setFocus(null);
  };
  const list = matches.length > 0 && (
    <div className="suggest-list">
      {matches.map((c) => (
        <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
          <b>{c.name}</b> <span className="muted small">{c.phone}</span>
        </button>
      ))}
    </div>
  );
  const onFocus = (f: 'name' | 'phone') => {
    clearTimeout(blurTimer.current);
    setFocus(f);
  };
  const onBlur = () => {
    blurTimer.current = setTimeout(() => setFocus(null), 150);
  };

  return (
    <>
      <div className="row">
        <label className="field suggest" style={{ flex: 1.4 }}>
          <span>Nume și prenume clientă</span>
          <input className="input" value={name} autoComplete="off" placeholder="ex.: Maria Popescu"
            onFocus={() => onFocus('name')} onBlur={onBlur}
            onChange={(e) => onChange({ client_name: e.target.value })} />
          {focus === 'name' && list}
        </label>
        <label className="field suggest">
          <span>Telefon</span>
          <input className="input" type="tel" inputMode="tel" value={phone} autoComplete="off" placeholder="07xx xxx xxx"
            onFocus={() => onFocus('phone')} onBlur={onBlur}
            onChange={(e) => onChange({ client_phone: e.target.value })} />
          {focus === 'phone' && list}
        </label>
      </div>
      {linked ? (
        <div className="meta-line" style={{ marginTop: -8 }}>
          Clientă existentă ·{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onOpenClient(linked.id); }}>vezi fișa și istoricul</a>{' · '}
          <a href="#" onClick={(e) => { e.preventDefault(); onChange({ client_id: null, client_name: '', client_phone: '' }); }}>altă clientă</a>
          {(linked.name !== name.trim() || linked.phone !== phone.trim()) && (
            <> · <span style={{ color: 'var(--warn)' }}>datele clientei se vor actualiza</span></>
          )}
        </div>
      ) : name.trim().length > 1 ? (
        <div className="meta-line" style={{ marginTop: -8 }}>Clientă nouă – va fi adăugată automat în fișier.</div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------ AppointmentHistory
const ACTION_LABEL: Record<string, string> = {
  create: 'Creată', update: 'Modificată', delete: 'Ștearsă', restore: 'Recuperată', rejected: 'Variantă respinsă (conflict)', erase: 'Ștearsă definitiv',
};

function AppointmentHistory({ appointment }: { appointment: Appointment }) {
  const user = useUser();
  const { confirm, toast } = useFeedback();
  const entries = useLiveQuery(
    () => db.history.where('entity_id').equals(appointment.id).toArray(),
    [appointment.id],
  ) ?? [];
  const sorted = [...entries].sort((a, b) => b.changed_at.localeCompare(a.changed_at));

  async function revert(h: HistoryEntry) {
    const s = h.snapshot;
    const ok = await confirm(
      <p style={{ margin: 0 }}>Reveniți la varianta din {formatDateTime(h.changed_at)}: <b>{s.date && formatLong(String(s.date).slice(0, 10))}</b>, {minToTime(Number(s.start_min))}, {s.service}?</p>,
      { title: 'Revenire la o versiune anterioară', ok: 'Revino' },
    );
    if (!ok) return;
    await revertToSnapshot(db, 'appointments', appointment.id, s, user);
    toast('Versiunea anterioară a fost restaurată');
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <h2 style={{ fontSize: 20 }}>Istoric modificări</h2>
      {sorted.length === 0 && <div className="muted small">Istoricul se descarcă la următoarea sincronizare.</div>}
      <div className="list">
        {sorted.map((h) => {
          const s = h.snapshot;
          return (
            <div key={h.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="grow small">
                <div>
                  <span className={`tag ${h.action}`}>{ACTION_LABEL[h.action] ?? h.action}</span>{' '}
                  {h.pending ? <span className="tag pending">nesincronizat</span> : null}{' '}
                  <b>{h.changed_by_name ?? '—'}</b> · {formatDateTime(h.changed_at)}
                </div>
                {s.date && (
                  <div className="muted">
                    {formatLong(String(s.date).slice(0, 10))}, {minToTime(Number(s.start_min))}–{minToTime(Number(s.start_min) + Number(s.duration_min))} · {s.client_name} · {s.service || '—'}
                    {s.notes ? ` · „${s.notes}”` : ''}
                  </div>
                )}
              </div>
              {s.date && <button className="btn sm" onClick={() => revert(h)}>Revino</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
