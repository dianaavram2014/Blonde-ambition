import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useAuth } from '../auth/AuthContext';
import { useFeedback } from '../components/ui';
import { useCounts, useStylists } from '../data/hooks';
import { supabase } from '../data/supabase';
import { appointmentsCSV, clientsCSV, download } from '../lib/csv';
import { buildBackupJSON } from '../data/sync';
import { formatDateTime, todayISO } from '../lib/dates';
import type { Profile, Stylist } from '../lib/types';

export function SettingsPage() {
  const { profile, logout, status, engine, preview } = useAuth();
  const counts = useCounts();
  const { confirm, toast } = useFeedback();
  const isAdmin = profile?.role === 'admin';
  const lastBackup = useLiveQuery(() => db.getMeta<string | null>('lastBackupAt', null), []);

  async function doLogout() {
    const msg = counts.pending
      ? <p style={{ margin: 0 }}>⚠ Aveți <b>{counts.pending} modificări nesincronizate</b>. Dacă vă deconectați acum, ele se pierd. Conectați-vă la internet și așteptați sincronizarea.<br /><br />Vă deconectați oricum?</p>
      : <p style={{ margin: 0 }}>Vă deconectați? Datele locale vor fi șterse de pe acest dispozitiv (rămân în siguranță în baza centrală).</p>;
    if (await confirm(msg, { title: 'Deconectare', ok: 'Deconectează-mă', danger: counts.pending > 0 })) await logout();
  }

  return (
    <div className="page">
      <h1>Setări</h1>
      <div className="page-sub">Cont, sincronizare, export și administrare</div>

      <div className="card">
        <h2>Contul meu</h2>
        <div><b>{profile?.display_name}</b> <span className="muted">({profile?.username})</span> · <span className="tag">{isAdmin ? 'Administrator' : 'Utilizator'}</span></div>
        {preview && <div className="notice warn small" style={{ marginTop: 10 }}>Mod previzualizare locală (fără server). Configurați Supabase pentru utilizare reală.</div>}
        <ChangePassword />
        <button className="btn danger" style={{ marginTop: 12 }} onClick={doLogout}>Deconectare</button>
      </div>

      <div className="card">
        <h2>Sincronizare</h2>
        <div className="small">
          Stare: <b>{{ online: 'Online – sincronizat', offline: 'Offline – date salvate local', syncing: 'Sincronizare în curs', error: 'Eroare', auth: 'Reconectare necesară' }[status.state]}</b><br />
          Modificări în așteptare: <b>{counts.pending}</b> · Conflicte: <b>{counts.conflicts}</b><br />
          Ultima sincronizare: <b>{status.lastSync ? formatDateTime(status.lastSync) : '—'}</b><br />
          Ultimul backup automat în cloud: <b>{lastBackup ? formatDateTime(lastBackup) : '—'}</b>
          {status.error && <div className="notice danger small" style={{ marginTop: 8 }}>{status.error}</div>}
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => engine?.syncNow()}>⟳ Sincronizează acum</button>
      </div>

      <ExportCard />

      {isAdmin && <StylistsCard />}
      {isAdmin && <UsersCard />}

      <div className="card">
        <h2>Instalare pe ecranul principal</h2>
        <div className="small">
          <b>iPhone / iPad (Safari):</b> butonul Partajare <span aria-hidden>⬆︎</span> → „Adaugă pe ecranul principal” → Adaugă.<br />
          <b>MacBook (Safari):</b> meniul Fișier → „Adaugă în Dock”. <b>Chrome:</b> iconița de instalare din bara de adrese.<br />
          <b>Android (Chrome):</b> meniul ⋮ → „Instalează aplicația”.
        </div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { toast('Verific actualizări…'); navigator.serviceWorker?.getRegistration().then((r) => r?.update()); }}>Verifică actualizări</button>
      </div>

      <div className="card">
        <h2>Confidențialitate (GDPR)</h2>
        <div className="small">
          Datele clientelor (nume, telefon, observații) sunt folosite exclusiv pentru programări. Accesul este permis doar
          conturilor salonului, prin autentificare individuală; conexiunea este criptată (HTTPS), iar parolele sunt
          stocate criptat (bcrypt) de serviciul de autentificare. Pe dispozitiv, datele se șterg la deconectare.
          Din fișa clientei puteți exporta datele ei sau (administrator) le puteți șterge definitiv la cerere.
          Recomandare: activați codul de blocare (Face ID / Touch ID) pe telefoanele folosite pentru agendă.
        </div>
      </div>
      <p className="tiny muted" style={{ textAlign: 'center' }}>Laboratorul de Culoare by Diana Avram · Smart Agenda v1.0</p>
    </div>
  );
}

function ChangePassword() {
  const { changePassword, preview } = useAuth();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (preview) return null;
  if (!open) return <button className="btn" style={{ marginTop: 12, marginRight: 8 }} onClick={() => setOpen(true)}>Schimbă parola</button>;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setErr('Parolele noi nu coincid.');
    setBusy(true);
    try {
      await changePassword(cur, next);
      toast('Parola a fost schimbată');
      setOpen(false);
      setCur(''); setNext(''); setAgain(''); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
      <label className="field"><span>Parola actuală</span><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field"><span>Parola nouă (min. 10 caractere)</span><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field"><span>Repetați parola nouă</span><input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {err && <div className="notice danger small">{err}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Renunță</button>
        <button className="btn primary" disabled={busy}>Salvează parola</button>
      </div>
    </form>
  );
}

function ExportCard() {
  const stylists = useStylists();
  const { toast } = useFeedback();
  const year = todayISO().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [all, setAll] = useState(true);

  async function exportAppts() {
    const [appts, clients] = await Promise.all([
      all ? db.appointments.toArray() : db.appointments.where('date').between(from, to, true, true).toArray(),
      db.clients.toArray(),
    ]);
    const csv = appointmentsCSV(appts, new Map(clients.map((c) => [c.id, c])), new Map(stylists.map((s) => [s.id, s])));
    download(`programari-${all ? 'toate' : `${from}_${to}`}.csv`, csv);
    toast(`${appts.length} programări exportate`);
  }
  async function exportClients() {
    const [clients, appts] = await Promise.all([db.clients.toArray(), db.appointments.toArray()]);
    download(`cliente-${todayISO()}.csv`, clientsCSV(clients, appts));
  }
  async function exportBackup() {
    download(`backup-agenda-${todayISO()}.json`, await buildBackupJSON(db), 'application/json');
  }

  return (
    <div className="card">
      <h2>Export și backup</h2>
      <div className="small muted" style={{ marginBottom: 10 }}>Fișierele CSV se deschid direct în Excel sau Numbers.</div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Toate programările (din toți anii)
      </label>
      {!all && (
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="field"><span>De la</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Până la</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={exportAppts}>⬇ Programări (Excel/CSV)</button>
        <button className="btn" onClick={exportClients}>⬇ Cliente (Excel/CSV)</button>
        <button className="btn" onClick={exportBackup}>⬇ Backup complet (JSON)</button>
      </div>
    </div>
  );
}

function StylistsCard() {
  const stylists = useLiveQuery(() => db.stylists.orderBy('sort').toArray(), []) ?? [];
  const { toast } = useFeedback();
  const { engine } = useAuth();
  const [edits, setEdits] = useState<Record<string, Partial<Stylist>>>({});
  async function save(s: Stylist) {
    if (!supabase) return toast('Indisponibil în modul previzualizare');
    const patch = edits[s.id];
    if (!patch) return;
    const { error } = await supabase.from('stylists').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) return toast('Eroare: ' + (navigator.onLine ? error.message : 'necesită internet'));
    setEdits((e) => ({ ...e, [s.id]: undefined as any }));
    toast('Salvat');
    engine?.syncNow();
  }
  return (
    <div className="card">
      <h2>Stiliste (coloanele din agendă)</h2>
      <div className="small muted" style={{ marginBottom: 10 }}>Puteți schimba numele afișat (ex. „Colega” → numele real) și culoarea. Necesită internet.</div>
      {stylists.map((s) => {
        const e = { ...s, ...edits[s.id] };
        return (
          <div key={s.id} className="row" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
            <label className="field"><span>Nume</span><input className="input" value={e.name} onChange={(ev) => setEdits((x) => ({ ...x, [s.id]: { ...x[s.id], name: ev.target.value } }))} /></label>
            <label className="field" style={{ flex: '0 0 70px' }}><span>Culoare</span><input className="input" type="color" style={{ padding: 4 }} value={e.color} onChange={(ev) => setEdits((x) => ({ ...x, [s.id]: { ...x[s.id], color: ev.target.value } }))} /></label>
            <button className="btn" style={{ flex: '0 0 auto' }} disabled={!edits[s.id]} onClick={() => save(s)}>Salvează</button>
          </div>
        );
      })}
    </div>
  );
}

function UsersCard() {
  const { toast, confirm } = useFeedback();
  const stylists = useStylists();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'user', stylist_id: 'colega' });

  async function call(body: Record<string, unknown>) {
    if (!supabase) throw new Error('Indisponibil în modul previzualizare');
    if (!navigator.onLine) throw new Error('Administrarea conturilor necesită internet.');
    const { data, error } = await supabase.functions.invoke('admin-users', { body });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as any).context?.json())?.error ?? msg; } catch { /* */ }
      throw new Error(msg);
    }
    return data;
  }
  async function load() {
    try {
      const d = await call({ action: 'list' });
      setUsers(d.users);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await call({ action: 'create', ...form });
      toast('Cont creat');
      setForm({ username: '', display_name: '', password: '', role: 'user', stylist_id: 'colega' });
      load();
    } catch (er) {
      toast(er instanceof Error ? er.message : String(er));
    }
  }
  async function resetPassword(u: Profile) {
    const pwd = prompt(`Parolă nouă pentru ${u.display_name} (min. 10 caractere):`);
    if (!pwd) return;
    try {
      await call({ action: 'set_password', user_id: u.id, password: pwd });
      toast('Parola a fost schimbată');
    } catch (er) {
      toast(er instanceof Error ? er.message : String(er));
    }
  }
  async function toggle(u: Profile) {
    if (!(await confirm(`${u.active ? 'Dezactivați' : 'Reactivați'} contul ${u.display_name}?`, { danger: u.active }))) return;
    try {
      await call({ action: 'update', user_id: u.id, active: !u.active });
      load();
    } catch (er) {
      toast(er instanceof Error ? er.message : String(er));
    }
  }

  return (
    <div className="card">
      <h2>Conturi utilizatori</h2>
      {err && <div className="notice warn small">{err}</div>}
      <div className="list">
        {users?.map((u) => (
          <div key={u.id} className="list-item">
            <div className="grow">
              <div className="title">{u.display_name} <span className="muted small">({u.username})</span></div>
              <div className="small muted">{u.role === 'admin' ? 'Administrator' : 'Utilizator'} · {u.active ? 'activ' : 'DEZACTIVAT'}</div>
            </div>
            <button className="btn sm" onClick={() => resetPassword(u)}>Parolă</button>
            <button className="btn sm danger" onClick={() => toggle(u)}>{u.active ? 'Dezactivează' : 'Activează'}</button>
          </div>
        ))}
      </div>
      <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <div className="label">Cont nou</div>
        <div className="row">
          <label className="field"><span>Utilizator</span><input className="input" value={form.username} autoCapitalize="none" onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label className="field"><span>Nume afișat</span><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field"><span>Parolă (min. 10)</span><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label className="field"><span>Rol</span>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">Utilizator</option><option value="admin">Administrator</option>
            </select>
          </label>
          <label className="field"><span>Coloana</span>
            <select className="input" value={form.stylist_id} onChange={(e) => setForm({ ...form, stylist_id: e.target.value })}>
              {stylists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn primary">Creează contul</button>
      </form>
    </div>
  );
}
