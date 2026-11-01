import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useUser } from '../auth/AuthContext';
import { useNav } from '../components/nav';
import { useFeedback } from '../components/ui';
import { restoreAppointment } from '../data/repo';
import { formatDateTime, formatLong, minToTime } from '../lib/dates';
import { useCounts } from '../data/hooks';

const ACTION: Record<string, string> = {
  create: 'Creată', update: 'Modificată', delete: 'Ștearsă', restore: 'Recuperată', rejected: 'Respinsă (conflict)', erase: 'Ștearsă definitiv',
};

type Tab = 'recent' | 'deleted' | 'pending';

export function HistoryPage() {
  const nav = useNav();
  const user = useUser();
  const { toast } = useFeedback();
  const counts = useCounts();
  const [tab, setTab] = useState<Tab>('recent');
  const [limit, setLimit] = useState(100);
  const history = useLiveQuery(() => db.history.orderBy('changed_at').reverse().limit(limit).toArray(), [limit]) ?? [];
  const deleted = useLiveQuery(() => db.appointments.filter((a) => a.deleted).toArray(), []) ?? [];
  const pending = useLiveQuery(() => db.outbox.orderBy('seq').toArray(), []) ?? [];
  const sortedDeleted = useMemo(() => [...deleted].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')), [deleted]);

  return (
    <div className="page">
      <h1>Istoric</h1>
      <div className="page-sub">Toate modificările, cine le-a făcut și când. Programările șterse pot fi recuperate oricând.</div>
      <div className="tabs">
        <div className="seg">
          <button className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>Modificări recente</button>
          <button className={tab === 'deleted' ? 'on' : ''} onClick={() => setTab('deleted')}>Programări șterse ({deleted.length})</button>
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Nesincronizate ({pending.length})</button>
        </div>
        {counts.conflicts > 0 && <button className="btn sm danger" onClick={nav.showConflicts}>⚠ {counts.conflicts} conflicte</button>}
      </div>

      {tab === 'recent' && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {history.length === 0 && <div className="empty">Istoricul este gol.</div>}
          <div className="list">
            {history.map((h) => {
              const s = h.snapshot;
              const isAppt = h.entity === 'appointments';
              return (
                <button key={h.id} className="list-item" onClick={() => (isAppt ? nav.openEdit(h.entity_id) : nav.openClient(h.entity_id))} disabled={h.action === 'erase'}>
                  <div className="grow">
                    <div className="small">
                      <span className={`tag ${h.action}`}>{ACTION[h.action] ?? h.action}</span>{' '}
                      {h.pending ? <span className="tag pending">nesincronizat</span> : null}{' '}
                      <b>{h.changed_by_name ?? '—'}</b> <span className="muted">· {formatDateTime(h.changed_at)}</span>
                    </div>
                    <div className="title" style={{ marginTop: 3 }}>
                      {isAppt ? `Programare: ${s.client_name ?? ''}` : h.action === 'erase' ? 'Date clientă șterse (GDPR)' : `Fișă clientă: ${s.name ?? ''}`}
                    </div>
                    {isAppt && s.date && (
                      <div className="small muted">
                        {formatLong(String(s.date).slice(0, 10))} · {minToTime(Number(s.start_min))}–{minToTime(Number(s.start_min) + Number(s.duration_min))} · {s.service || '—'}
                      </div>
                    )}
                    {!isAppt && s.phone && <div className="small muted">☎ {s.phone}</div>}
                  </div>
                </button>
              );
            })}
          </div>
          {history.length >= limit && (
            <div style={{ textAlign: 'center', padding: 12 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 200)}>Mai multe…</button>
            </div>
          )}
        </div>
      )}

      {tab === 'deleted' && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {sortedDeleted.length === 0 && <div className="empty">Nicio programare ștearsă.</div>}
          <div className="list">
            {sortedDeleted.map((a) => (
              <div key={a.id} className="list-item">
                <div className="grow" onClick={() => nav.openEdit(a.id)} style={{ cursor: 'pointer' }}>
                  <div className="title">{a.client_name}</div>
                  <div className="small muted">
                    {formatLong(a.date)} · {minToTime(a.start_min)} · {a.service || '—'}
                  </div>
                  <div className="tiny muted">ștearsă de {a.updated_by_name ?? '—'} · {formatDateTime(a.updated_at)}</div>
                </div>
                <button className="btn sm gold" onClick={async () => { await restoreAppointment(db, a.id, user); toast('Programare recuperată'); }}>
                  ↺ Recuperează
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'pending' && (
        <div className="card" style={{ padding: '4px 14px' }}>
          {pending.length === 0 && <div className="empty">Toate modificările sunt sincronizate. ✓</div>}
          <div className="list">
            {pending.map((p) => {
              const d = p.data as any;
              return (
                <div key={p.key} className="list-item">
                  <div className="grow">
                    <div className="title">{p.entity === 'appointments' ? `Programare: ${d.client_name}` : `Clientă: ${d.name}`}</div>
                    <div className="small muted">
                      {p.entity === 'appointments' && `${formatLong(d.date)} · ${minToTime(d.start_min)} · `}
                      salvată local {formatDateTime(p.createdAt)} – se trimite automat când există internet
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
