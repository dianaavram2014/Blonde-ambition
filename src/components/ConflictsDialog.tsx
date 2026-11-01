import { useLiveQuery } from 'dexie-react-hooks';
import { Modal, useFeedback } from './ui';
import { db, useAuth, useUser } from '../auth/AuthContext';
import { formatDateTime, formatLong, minToTime, formatDuration } from '../lib/dates';
import type { Conflict } from '../lib/types';
import { useStylists } from '../data/hooks';

const LABELS: Record<string, string> = {
  client_name: 'Clientă', client_phone: 'Telefon', name: 'Nume', phone: 'Telefon', stylist_id: 'Stilistă',
  date: 'Data', start_min: 'Ora', duration_min: 'Durata', service: 'Serviciu', notes: 'Observații', deleted: 'Stare',
};

export function ConflictsDialog({ onClose }: { onClose: () => void }) {
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), []) ?? [];
  return (
    <Modal title="Conflicte de sincronizare" size="lg" onClose={onClose}>
      <div className="notice info small">
        Aceeași programare a fost modificată pe două dispozitive în timp ce cel puțin unul era offline.
        Alegeți varianta corectă. <b>Nicio variantă nu se pierde</b> – cea respinsă rămâne în istoric.
      </div>
      {conflicts.length === 0 && <div className="empty">Nu există conflicte. Totul este sincronizat. ✓</div>}
      {conflicts.map((c) => <ConflictCard key={c.key} c={c} />)}
    </Modal>
  );
}

function ConflictCard({ c }: { c: Conflict }) {
  const { engine } = useAuth();
  const user = useUser();
  const stylists = useStylists();
  const { toast } = useFeedback();
  const fmt = (field: string, v: any): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'date') return formatLong(String(v).slice(0, 10));
    if (field === 'start_min') return minToTime(Number(v));
    if (field === 'duration_min') return formatDuration(Number(v));
    if (field === 'stylist_id') return stylists.find((s) => s.id === v)?.name ?? String(v);
    if (field === 'deleted') return v ? 'ȘTEARSĂ' : 'activă';
    return String(v);
  };
  const fields = Object.keys(LABELS).filter((f) => f in (c.local as any));
  const server = c.server as any;
  const local = c.local as any;

  async function resolve(choice: 'local' | 'server') {
    await engine?.resolveConflict(c.key, choice, user);
    toast(choice === 'local' ? 'Am păstrat varianta dumneavoastră' : 'Am păstrat varianta de pe server');
  }

  return (
    <div className="card">
      <h2>{c.entity === 'appointments' ? 'Programare' : 'Fișă clientă'}: {local.client_name ?? local.name}</h2>
      {!server && <div className="notice warn small">Pe server această înregistrare a fost ștearsă definitiv.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="diff-table">
          <thead>
            <tr>
              <th />
              <th>Varianta de pe acest dispozitiv<br /><span className="tiny">{c.localBy ?? ''}</span></th>
              <th>Varianta de pe server<br /><span className="tiny">{server ? `${server.updated_by_name ?? ''} · ${formatDateTime(server.updated_at)}` : 'ștearsă'}</span></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const a = fmt(f, local[f]);
              const b = server ? fmt(f, server[f]) : '—';
              return (
                <tr key={f} className={a !== b ? 'diff' : ''}>
                  <td>{LABELS[f]}</td>
                  <td>{a}</td>
                  <td>{b}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => resolve('local')}>Păstrează varianta mea</button>
        <button className="btn" onClick={() => resolve('server')}>{server ? 'Păstrează varianta de pe server' : 'Acceptă ștergerea'}</button>
      </div>
    </div>
  );
}
