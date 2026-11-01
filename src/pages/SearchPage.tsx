import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useAuth, useUser } from '../auth/AuthContext';
import { useNav } from '../components/nav';
import { Modal, initials, useFeedback } from '../components/ui';
import { normalize, normalizePhone, serviceStyle } from '../lib/services';
import { formatDuration, formatLong, minToTime, todayISO } from '../lib/dates';
import { saveClient } from '../data/repo';
import { useStylists } from '../data/hooks';
import { supabase } from '../data/supabase';
import { download, toCSV } from '../lib/csv';
import type { Appointment, Client } from '../lib/types';

export function SearchPage() {
  const nav = useNav();
  const [q, setQ] = useState('');
  const clients = useLiveQuery(() => db.clients.filter((c) => !c.deleted).toArray(), []) ?? [];
  const appts = useLiveQuery(() => db.appointments.filter((a) => !a.deleted).toArray(), []) ?? [];
  const today = todayISO();

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last?: string; next?: string }>();
    for (const a of appts) {
      if (!a.client_id) continue;
      const s = m.get(a.client_id) ?? { count: 0 };
      s.count++;
      if (a.date < today && (!s.last || a.date > s.last)) s.last = a.date;
      if (a.date >= today && (!s.next || a.date < s.next)) s.next = a.date;
      m.set(a.client_id, s);
    }
    return m;
  }, [appts, today]);

  const results = useMemo(() => {
    const nq = normalize(q);
    const pq = normalizePhone(q);
    const list = !nq
      ? clients
      : clients.filter((c) => normalize(c.name).includes(nq) || (pq.length >= 3 && normalizePhone(c.phone).includes(pq)));
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ro')).slice(0, 200);
  }, [clients, q]);

  return (
    <div className="page">
      <h1>Caută clientă</h1>
      <div className="page-sub">{clients.length} cliente în fișier · căutare după nume sau număr de telefon</div>
      <div className="search-box">
        <span className="ico">🔍</span>
        <input className="input" autoFocus placeholder="Nume sau telefon…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {results.length === 0 && <div className="empty">Nicio clientă găsită.</div>}
        <div className="list">
          {results.map((c) => {
            const s = stats.get(c.id);
            return (
              <button key={c.id} className="list-item" onClick={() => nav.openClient(c.id)}>
                <div className="avatar">{initials(c.name)}</div>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="small muted">{c.phone || 'fără telefon'}</div>
                </div>
                <div className="small muted" style={{ textAlign: 'right' }}>
                  {(s?.count ?? 0) === 1 ? '1 programare' : `${s?.count ?? 0} programări`}
                  {s?.next && <div style={{ color: 'var(--gold-deep)' }}>următoarea: {s.next.split('-').reverse().join('.')}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ClientDialog({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const nav = useNav();
  const user = useUser();
  const { profile } = useAuth();
  const { toast, confirm } = useFeedback();
  const stylists = useStylists();
  const client = useLiveQuery(async () => (await db.clients.get(clientId)) ?? null, [clientId]);
  const appts = useLiveQuery(() => db.appointments.where('client_id').equals(clientId).toArray(), [clientId]) ?? [];
  const [edit, setEdit] = useState<{ name: string; phone: string; notes: string } | null>(null);
  const today = todayISO();

  if (client === undefined) return null;
  if (client === null) {
    return <Modal title="Clientă" onClose={onClose}><div className="empty">Clienta nu a fost găsită.</div></Modal>;
  }

  const active = appts.filter((a) => !a.deleted);
  const future = active.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
  const past = active.filter((a) => a.date < today).sort((a, b) => b.date.localeCompare(a.date) || b.start_min - a.start_min);

  async function save() {
    if (!edit) return;
    try {
      await saveClient(db, clientId, edit, user);
      toast('Fișa clientei a fost actualizată');
      setEdit(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }

  function exportData() {
    const c = client!;
    download(`date-clienta-${normalize(c.name).replace(/\s+/g, '-')}.csv`, toCSV([
      ['Nume', c.name], ['Telefon', c.phone], ['Observații', c.notes], [],
      ['Data', 'Ora', 'Durata', 'Serviciu', 'Stilistă', 'Observații'],
      ...active.sort((a, b) => a.date.localeCompare(b.date)).map((a) => [a.date, minToTime(a.start_min), formatDuration(a.duration_min), a.service, stylists.find((s) => s.id === a.stylist_id)?.name ?? a.stylist_id, a.notes]),
    ]));
  }

  async function erase() {
    if (!supabase) return;
    if (!navigator.onLine) return toast('Ștergerea definitivă necesită internet.');
    const ok = await confirm(
      <p style={{ margin: 0 }}>
        Ștergeți <b>DEFINITIV</b> toate datele clientei <b>{client!.name}</b> ({appts.length} programări, inclusiv istoricul)?
        Operația <b>nu poate fi anulată</b>. Folosiți-o doar la cererea clientei (GDPR – dreptul de a fi uitat).
      </p>,
      { title: 'Ștergere definitivă (GDPR)', ok: 'Șterge definitiv', danger: true },
    );
    if (!ok) return;
    const { error } = await supabase.rpc('erase_client', { p_id: clientId });
    if (error) return toast('Eroare: ' + error.message);
    // ștergere locală imediată
    await db.transaction('rw', [db.clients, db.appointments, db.history, db.outbox], async () => {
      const ids = appts.map((a) => a.id);
      await db.appointments.bulkDelete(ids);
      await db.clients.delete(clientId);
      await db.history.where('entity_id').anyOf([clientId, ...ids]).delete();
      await db.outbox.bulkDelete([`clients:${clientId}`, ...ids.map((i) => `appointments:${i}`)]);
    });
    toast('Datele clientei au fost șterse definitiv');
    onClose();
  }

  return (
    <Modal
      title={client.name}
      onClose={onClose}
      footer={
        <button className="btn big gold" onClick={() => nav.openNew({ client_id: clientId })}>＋ Programare nouă pentru {client.name.split(' ')[0]}</button>
      }
    >
      {edit ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field"><span>Nume și prenume</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Telefon</span><input className="input" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="field"><span>Observații despre clientă</span><textarea className="input" value={edit.notes} placeholder="Alergii, preferințe, formula preferată…" onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          <div className="row">
            <button className="btn" onClick={() => setEdit(null)}>Renunță</button>
            <button className="btn primary" onClick={save}>Salvează fișa</button>
          </div>
          <div className="tiny muted">Istoricul programărilor se păstrează integral după modificare.</div>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="avatar" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(client.name)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>☎ {client.phone}</a> : <span className="muted">fără telefon</span>}</div>
              <div className="small muted">{active.length} programări · {future.length} viitoare</div>
            </div>
            <button className="btn sm" onClick={() => setEdit({ name: client.name, phone: client.phone, notes: client.notes })}>Modifică</button>
          </div>
          {client.notes && <div className="notice info small" style={{ marginTop: 12 }}>{client.notes}</div>}
        </div>
      )}

      <AppointmentList title="Programări viitoare" list={future} empty="Nicio programare viitoare." />
      <AppointmentList title="Programări anterioare" list={past} empty="Nicio programare anterioară." />

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={exportData}>Exportă datele clientei (GDPR)</button>
        {profile?.role === 'admin' && <button className="btn sm danger" onClick={erase}>Ștergere definitivă (GDPR)</button>}
      </div>
    </Modal>
  );
}

function AppointmentList({ title, list, empty }: { title: string; list: Appointment[]; empty: string }) {
  const nav = useNav();
  const stylists = useStylists();
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>{title} ({list.length})</div>
      <div className="card" style={{ padding: '2px 12px' }}>
        {list.length === 0 && <div className="muted small" style={{ padding: 12 }}>{empty}</div>}
        <div className="list">
          {list.map((a) => {
            const st = serviceStyle(a.service);
            return (
              <button key={a.id} className="list-item" onClick={() => nav.openEdit(a.id)}>
                <div style={{ width: 6, alignSelf: 'stretch', borderRadius: 4, background: st.ink }} />
                <div className="grow">
                  <div className="title">{formatLong(a.date)}</div>
                  <div className="small">{minToTime(a.start_min)}–{minToTime(a.start_min + a.duration_min)} · {a.service || '—'} · {stylists.find((s) => s.id === a.stylist_id)?.name ?? a.stylist_id}</div>
                  {a.notes && <div className="small muted">„{a.notes}”</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export type { Client };
