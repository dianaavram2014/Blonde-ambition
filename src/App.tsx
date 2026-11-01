import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { FeedbackProvider } from './components/ui';
import { NavCtx, useNav as useContextNav, type CalView, type NavApi, type NewPrefill, type Page } from './components/nav';
import { CalendarPage } from './pages/CalendarPage';
import { SearchPage, ClientDialog } from './pages/SearchPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AppointmentDialog } from './components/AppointmentDialog';
import { ConflictsDialog } from './components/ConflictsDialog';
import { useCounts } from './data/hooks';
import { formatDateTime, todayISO } from './lib/dates';

export default function App() {
  return (
    <AuthProvider>
      <FeedbackProvider>
        <Gate />
      </FeedbackProvider>
    </AuthProvider>
  );
}

function Gate() {
  const { profile, ready } = useAuth();
  if (!ready) return <div className="splash">Laboratorul de Culoare…</div>;
  if (!profile) return <LoginPage />;
  return <Shell />;
}

function loadSession<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function Shell() {
  const { profile } = useAuth();
  const [page, setPage] = useState<Page>('calendar');
  const [calDate, setCalDate] = useState(() => todayISO());
  const [calView, setCalView] = useState<CalView>(() => loadSession<CalView>('lc-view', 'day'));
  const [apptDialog, setApptDialog] = useState<{ id: string | null; prefill?: NewPrefill; n: number } | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem('lc-view', JSON.stringify(calView)); } catch { /* */ }
  }, [calView]);

  const nav: NavApi = useMemo(() => ({
    page,
    setPage: (p) => { setPage(p); window.scrollTo(0, 0); },
    calDate,
    setCalDate,
    calView,
    setCalView,
    goToday: () => { setCalDate(todayISO()); setPage('calendar'); },
    openNew: (prefill) => { setClientId(null); setApptDialog({ id: null, prefill, n: Date.now() }); },
    openEdit: (id) => { setClientId(null); setApptDialog({ id, n: Date.now() }); },
    openClient: (id) => { setApptDialog(null); setClientId(id); },
    showConflicts: () => { setApptDialog(null); setConflictsOpen(true); },
  }), [page, calDate, calView]);

  const closeAppt = useCallback(() => setApptDialog(null), []);

  return (
    <NavCtx.Provider value={nav}>
      <div className="app">
        <header className="header">
          <div className="header-inner">
            <button className="brand" onClick={nav.goToday} title="Astăzi">
              <div className="brand-mark">LC</div>
              <div className="brand-text">
                <b>Laboratorul de Culoare</b>
                <small>by Diana Avram</small>
              </div>
            </button>
            <nav className="topnav">
              <button className={page === 'calendar' ? 'on' : ''} onClick={() => nav.setPage('calendar')}>Calendar</button>
              <button className={page === 'search' ? 'on' : ''} onClick={() => nav.setPage('search')}>Caută clientă</button>
              <button className={page === 'history' ? 'on' : ''} onClick={() => nav.setPage('history')}>Istoric</button>
              <button className={page === 'settings' ? 'on' : ''} onClick={() => nav.setPage('settings')}>Setări</button>
            </nav>
            <div className="header-spacer" />
            <SyncPill />
            <span className="small muted desk-only">{profile?.display_name}</span>
          </div>
        </header>
        <SyncBanner />

        <main className="main">
          {page === 'calendar' && <CalendarPage />}
          {page === 'search' && <SearchPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>

        <nav className="bottomnav">
          <div className="bottomnav-inner">
            <button className={page === 'calendar' ? 'on' : ''} onClick={() => nav.setPage('calendar')}><span className="ico">🗓</span>Calendar</button>
            <button className={page === 'search' ? 'on' : ''} onClick={() => nav.setPage('search')}><span className="ico">🔍</span>Caută</button>
            <button className="fab" onClick={() => nav.openNew({ date: page === 'calendar' ? calDate : todayISO() })} aria-label="Programare nouă">＋</button>
            <button className={page === 'history' ? 'on' : ''} onClick={() => nav.setPage('history')}><span className="ico">↺</span>Istoric</button>
            <button className={page === 'settings' ? 'on' : ''} onClick={() => nav.setPage('settings')}><span className="ico">⚙︎</span>Setări</button>
          </div>
        </nav>
      </div>

      {apptDialog && (
        <AppointmentDialog
          key={apptDialog.n}
          appointmentId={apptDialog.id}
          prefill={apptDialog.prefill}
          defaultStylist={profile?.stylist_id ?? undefined}
          onClose={closeAppt}
          onOpenClient={nav.openClient}
          onShowConflicts={nav.showConflicts}
        />
      )}
      {clientId && <ClientDialog key={clientId} clientId={clientId} onClose={() => setClientId(null)} />}
      {conflictsOpen && <ConflictsDialog onClose={() => setConflictsOpen(false)} />}
    </NavCtx.Provider>
  );
}

function SyncPill() {
  const { status, engine } = useAuth();
  const { pending, conflicts } = useCounts();
  const nav = useContextNav();
  let cls: string = status.state;
  let text: string;
  if (conflicts > 0) {
    cls = 'conflict';
    text = `Conflict de sincronizare (${conflicts})`;
  } else if (status.state === 'syncing') text = 'Sincronizare în curs';
  else if (status.state === 'offline') text = pending ? `Offline – ${pending} modificări salvate local` : 'Offline – date salvate local';
  else if (status.state === 'auth') text = 'Reconectare necesară';
  else if (status.state === 'error') text = 'Eroare sincronizare';
  else if (pending > 0) { cls = 'pending'; text = `${pending} în așteptare`; }
  else text = 'Online – sincronizat';
  return (
    <button
      className={`sync-pill ${cls}`}
      onClick={() => (conflicts ? nav.showConflicts() : engine?.syncNow())}
      title={status.lastSync ? `Ultima sincronizare: ${formatDateTime(status.lastSync)}` : 'Apăsați pentru sincronizare'}
    >
      <span className="sync-dot" />
      <span>{text}</span>
    </button>
  );
}

function SyncBanner() {
  const { status, profile } = useAuth();
  const [relogin, setRelogin] = useState(false);
  if (status.state !== 'auth') return null;
  return (
    <div className="banner warn">
      <span style={{ flex: 1 }}>Sesiunea a expirat. Agenda funcționează în continuare local, dar pentru sincronizare trebuie să vă reconectați.</span>
      {relogin ? <ReloginForm username={profile?.username ?? ''} onDone={() => setRelogin(false)} /> : <button className="btn sm primary" onClick={() => setRelogin(true)}>Reconectare</button>}
    </div>
  );
}

function ReloginForm({ username, onDone }: { username: string; onDone: () => void }) {
  const { login } = useAuth();
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await login(username, pwd);
          onDone();
        } catch (er) {
          setErr(er instanceof Error ? er.message : String(er));
        }
      }}
    >
      <input className="input" style={{ minHeight: 36, width: 200 }} type="password" placeholder={`Parola pentru ${username}`} value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
      <button className="btn sm primary">Conectare</button>
      {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
    </form>
  );
}

