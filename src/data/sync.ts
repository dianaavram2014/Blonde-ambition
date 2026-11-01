import type { AgendaDB } from './db';
import { AuthError, NetworkError, type Remote } from './remote';
import { uuid } from './db';
import type { Appointment, Client, Conflict, Entity, HistoryEntry, OutboxItem } from '../lib/types';
import { APPOINTMENT_FIELDS, CLIENT_FIELDS } from '../lib/types';
import { todayISO } from '../lib/dates';

export type SyncState = 'online' | 'offline' | 'syncing' | 'error' | 'auth';

export interface SyncStatus {
  state: SyncState;
  lastSync: string | null;
  error: string | null;
}

const ENTITIES: Entity[] = ['clients', 'appointments'];
const META_FIELDS = ['version', 'created_at', 'created_by', 'created_by_name', 'updated_at', 'updated_by', 'updated_by_name'] as const;

/** Normalizează un rând primit de la server la forma locală. */
export function normalizeRow(entity: Entity, raw: Record<string, any>): Appointment | Client {
  const fields = entity === 'appointments' ? APPOINTMENT_FIELDS : CLIENT_FIELDS;
  const out: Record<string, any> = { id: raw.id };
  for (const f of fields) out[f] = raw[f];
  for (const f of META_FIELDS) out[f] = raw[f] ?? null;
  if (entity === 'appointments') {
    out.date = String(raw.date).slice(0, 10);
    out.start_min = Number(raw.start_min);
    out.duration_min = Number(raw.duration_min);
    out.client_id = raw.client_id ?? null;
    out.client_phone = raw.client_phone ?? '';
    out.service = raw.service ?? '';
  } else {
    out.phone = raw.phone ?? '';
  }
  out.notes = raw.notes ?? '';
  out.deleted = !!raw.deleted;
  out.version = Number(raw.version ?? 0);
  return out as Appointment | Client;
}

/**
 * Motorul de sincronizare:
 *  1. trimite modificările locale (coada "outbox") către server, cu versiunea de bază;
 *  2. dacă serverul are între timp altă versiune => se creează un conflict, iar
 *     ambele variante se păstrează până când utilizatorul alege;
 *  3. descarcă modificările făcute de celelalte dispozitive;
 *  4. descarcă jurnalul de modificări și face backup zilnic în cloud.
 */
export class SyncEngine {
  status: SyncStatus = { state: 'offline', lastSync: null, error: null };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private db: AgendaDB,
    private remote: Remote,
    private opts: { isOnline?: () => boolean; backups?: boolean } = {},
  ) {}

  private isOnline() {
    if (this.opts.isOnline) return this.opts.isOnline();
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  /** Pornește sincronizarea automată (online/offline, realtime, periodic). */
  async start() {
    this.status.lastSync = await this.db.getMeta<string | null>('lastSync', null);
    if (typeof window !== 'undefined') {
      const go = () => this.schedule(0);
      const off = () => this.setStatus({ state: 'offline' });
      const vis = () => document.visibilityState === 'visible' && this.schedule(0);
      window.addEventListener('online', go);
      window.addEventListener('offline', off);
      document.addEventListener('visibilitychange', vis);
      const iv = setInterval(() => this.schedule(0), 60_000);
      this.cleanup.push(() => {
        window.removeEventListener('online', go);
        window.removeEventListener('offline', off);
        document.removeEventListener('visibilitychange', vis);
        clearInterval(iv);
      });
    }
    try {
      this.cleanup.push(this.remote.subscribe(() => this.schedule(250)));
    } catch {
      /* realtime indisponibil – rămâne sincronizarea periodică */
    }
    this.schedule(0);
  }

  stop() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    if (this.timer) clearTimeout(this.timer);
  }

  /** Programează o sincronizare (cu mică întârziere pentru a grupa modificările). */
  schedule(delay = 400) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce() {
    if (!this.isOnline()) {
      this.setStatus({ state: 'offline' });
      return;
    }
    try {
      if (!(await this.remote.hasSession())) {
        this.setStatus({ state: 'auth' });
        return;
      }
      this.setStatus({ state: 'syncing', error: null });
      await this.pushAll();
      await this.pullStylists();
      await this.pullAll();
      await this.pullHistory();
      // dacă între timp s-au făcut modificări locale, le trimitem imediat
      if ((await this.db.outbox.count()) > 0) await this.pushAll();
      const now = new Date().toISOString();
      await this.db.setMeta('lastSync', now);
      this.setStatus({ state: 'online', lastSync: now, error: null });
      if (this.opts.backups !== false) await this.maybeBackup();
    } catch (e) {
      if (e instanceof NetworkError) this.setStatus({ state: 'offline' });
      else if (e instanceof AuthError) this.setStatus({ state: 'auth' });
      else {
        console.error('Eroare sincronizare', e);
        this.setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // ------------------------------------------------------------------ push
  private async pushAll() {
    const items = await this.db.outbox.orderBy('seq').toArray();
    for (const item of items) await this.pushOne(item);
  }

  private async pushOne(item: OutboxItem) {
    const res = await this.remote.push(item.entity, {
      id: item.id,
      baseVersion: item.baseVersion,
      mutationId: item.mutationId,
      data: item.data,
    });
    const table = this.table(item.entity);
    await this.db.transaction('rw', [table, this.db.outbox, this.db.conflicts, this.db.history], async () => {
      const current = await this.db.outbox.get(item.key);
      if (res.status === 'ok') {
        const row = normalizeRow(item.entity, res.row);
        if (current && current.mutationId === item.mutationId) {
          await this.db.outbox.delete(item.key);
          await table.put(row as any);
        } else if (current) {
          // s-a mai modificat ceva local în timpul trimiterii: păstrăm datele locale
          // și le trimitem pe versiunea nouă
          await this.db.outbox.update(item.key, { baseVersion: row.version });
          const local = await table.get(item.id);
          if (local) {
            const meta: Record<string, unknown> = {};
            for (const f of META_FIELDS) if (f !== 'updated_by' && f !== 'updated_by_name') meta[f] = (row as any)[f];
            await table.update(item.id, meta as any);
          }
        }
        await this.db.history.where('mutation_id').equals(item.mutationId).modify({ pending: 0 });
      } else {
        const latest = current ?? item;
        const local = (await table.get(item.id)) as any;
        const conflict: Conflict = {
          key: item.key,
          entity: item.entity,
          id: item.id,
          local: latest.data,
          localBaseVersion: latest.baseVersion,
          localBy: local?.updated_by_name ?? null,
          server: res.status === 'conflict' ? normalizeRow(item.entity, res.row) : null,
          detectedAt: new Date().toISOString(),
        };
        await this.db.conflicts.put(conflict);
        await this.db.outbox.delete(item.key);
      }
    });
  }

  // ------------------------------------------------------------------ pull
  private async pullAll() {
    for (const entity of ENTITIES) {
      const cursorKey = `cursor:${entity}`;
      const since = await this.db.getMeta<string | null>(cursorKey, null);
      const rows = await this.remote.pull(entity, since);
      if (!rows.length) continue;
      const table = this.table(entity);
      let maxTs = since;
      await this.db.transaction('rw', [table, this.db.outbox, this.db.conflicts, this.db.meta], async () => {
        const pendingKeys = new Set(await this.db.outbox.toCollection().primaryKeys());
        const conflictKeys = new Set(await this.db.conflicts.toCollection().primaryKeys());
        for (const raw of rows) {
          const row = normalizeRow(entity, raw);
          const key = `${entity}:${row.id}`;
          if (row.updated_at && (!maxTs || row.updated_at > maxTs)) maxTs = row.updated_at;
          if (pendingKeys.has(key)) continue; // modificarea locală are prioritate până la trimitere
          if (conflictKeys.has(key)) {
            await this.db.conflicts.update(key, { server: row });
            continue;
          }
          const existing = await table.get(row.id);
          if (existing && existing.version > row.version) continue;
          await table.put(row as any);
        }
        if (maxTs) await this.db.setMeta(cursorKey, maxTs);
      });
    }
  }

  private async pullStylists() {
    const stylists = await this.remote.pullStylists();
    if (!stylists.length) return;
    await this.db.transaction('rw', this.db.stylists, async () => {
      await this.db.stylists.clear();
      await this.db.stylists.bulkPut(stylists);
    });
  }

  private async pullHistory() {
    const after = await this.db.getMeta<number>('cursor:history', 0);
    const rows = await this.remote.pullHistory(after);
    if (!rows.length) return;
    await this.db.transaction(
      'rw',
      [this.db.history, this.db.meta, this.db.appointments, this.db.clients, this.db.outbox, this.db.conflicts],
      async () => {
        let max = after;
        for (const r of rows) {
          max = Math.max(max, r.id);
          if (r.action === 'erase') {
            await this.eraseLocal(r.entity_id);
            continue;
          }
          const entry: HistoryEntry = {
            id: `s:${r.id}`,
            entity: r.entity,
            entity_id: r.entity_id,
            action: r.action as HistoryEntry['action'],
            version: r.version,
            snapshot: r.snapshot as HistoryEntry['snapshot'],
            mutation_id: r.mutation_id,
            changed_by_name: r.changed_by_name,
            changed_at: r.changed_at,
            pending: 0,
          };
          await this.db.history.put(entry);
          if (r.mutation_id) await this.db.history.delete(`l:${r.mutation_id}`);
        }
        await this.db.setMeta('cursor:history', max);
      },
    );
  }

  /** Ștergere definitivă locală (GDPR) a unei cliente și a programărilor ei. */
  private async eraseLocal(clientId: string) {
    const appts = await this.db.appointments.where('client_id').equals(clientId).toArray();
    const ids = [clientId, ...appts.map((a) => a.id)];
    await this.db.clients.delete(clientId);
    await this.db.appointments.bulkDelete(appts.map((a) => a.id));
    await this.db.history.where('entity_id').anyOf(ids).delete();
    await this.db.outbox.bulkDelete([`clients:${clientId}`, ...appts.map((a) => `appointments:${a.id}`)]);
    await this.db.conflicts.bulkDelete([`clients:${clientId}`, ...appts.map((a) => `appointments:${a.id}`)]);
  }

  // ------------------------------------------------------------- conflicts
  /**
   * Rezolvă un conflict. Nicio variantă nu se pierde: cea respinsă rămâne în istoric.
   *  'local'  => varianta de pe acest dispozitiv devine cea finală;
   *  'server' => se păstrează varianta din baza centrală.
   */
  async resolveConflict(key: string, choice: 'local' | 'server', user: { id: string; name: string }) {
    const c = await this.db.conflicts.get(key);
    if (!c) return;
    const table = this.table(c.entity);
    const now = new Date().toISOString();
    await this.db.transaction('rw', [table, this.db.outbox, this.db.conflicts, this.db.history, this.db.meta], async () => {
      if (choice === 'server') {
        if (c.server) await table.put(c.server as any);
        else await table.delete(c.id);
        await this.db.history.put({
          id: `l:rej:${uuid()}`,
          entity: c.entity,
          entity_id: c.id,
          action: 'rejected',
          version: null,
          snapshot: { ...(c.local as any), id: c.id },
          mutation_id: null,
          changed_by_name: c.localBy,
          changed_at: now,
          pending: 0,
        });
      } else {
        const mutationId = uuid();
        const seq = await nextSeq(this.db);
        await this.db.outbox.put({
          key,
          entity: c.entity,
          id: c.id,
          baseVersion: c.server ? c.server.version : 0,
          mutationId,
          data: c.local,
          seq,
          createdAt: now,
        });
        const local = await table.get(c.id);
        await table.put({
          ...(c.server ?? {}),
          ...(local ?? {}),
          ...(c.local as any),
          id: c.id,
          version: c.server ? c.server.version : 0,
          updated_by: user.id,
          updated_by_name: user.name,
          updated_at: now,
        } as any);
        if (c.server) {
          await this.db.history.put({
            id: `l:rej:${uuid()}`,
            entity: c.entity,
            entity_id: c.id,
            action: 'rejected',
            version: c.server.version,
            snapshot: c.server as any,
            mutation_id: null,
            changed_by_name: c.server.updated_by_name,
            changed_at: now,
            pending: 0,
          });
        }
      }
      await this.db.conflicts.delete(key);
    });
    this.schedule(0);
  }

  // ---------------------------------------------------------------- backup
  private async maybeBackup() {
    const today = todayISO();
    const last = await this.db.getMeta<string | null>('lastBackupDay', null);
    if (last === today) return;
    try {
      const json = await buildBackupJSON(this.db);
      await this.remote.uploadBackup(`agenda-${today}.json`, json);
      await this.db.setMeta('lastBackupDay', today);
      await this.db.setMeta('lastBackupAt', new Date().toISOString());
    } catch (e) {
      console.warn('Backup cloud nereușit (se reîncearcă la următoarea sincronizare)', e);
    }
  }

  private table(entity: Entity) {
    return entity === 'appointments' ? this.db.appointments : this.db.clients;
  }
}

export async function nextSeq(db: AgendaDB): Promise<number> {
  const n = (await db.getMeta<number>('seq', 0)) + 1;
  await db.setMeta('seq', n);
  return n;
}

export async function buildBackupJSON(db: AgendaDB): Promise<string> {
  const [appointments, clients, stylists] = await Promise.all([
    db.appointments.toArray(),
    db.clients.toArray(),
    db.stylists.toArray(),
  ]);
  return JSON.stringify({
    app: 'Laboratorul de Culoare – Smart Agenda',
    exported_at: new Date().toISOString(),
    stylists,
    clients,
    appointments,
  });
}
