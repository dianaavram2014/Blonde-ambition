/**
 * Server în memorie cu ACEEAȘI logică de versiuni/conflicte ca funcțiile SQL
 * push_appointment / push_client. Folosit numai pentru teste automate și
 * pentru previzualizarea locală în modul dezvoltare – NU în producție.
 */
import type { Appointment, Client, Entity, Stylist } from '../lib/types';
import { sameData } from '../lib/types';
import { DEFAULT_STYLISTS } from './db';
import { NetworkError, type PushRequest, type PushResult, type Remote, type RemoteHistoryRow } from './remote';

type Row = (Appointment | Client) & { last_mutation_id: string | null };

export class MemoryServer {
  tables: Record<Entity, Map<string, Row>> = { appointments: new Map(), clients: new Map() };
  log: RemoteHistoryRow[] = [];
  stylists: Stylist[] = DEFAULT_STYLISTS.map((s) => ({ ...s }));
  backups = new Map<string, string>();
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private listeners = new Set<() => void>();

  private tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  notify() {
    for (const l of this.listeners) l();
  }

  listen(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  push(entity: Entity, req: PushRequest, user: { id: string; name: string }): PushResult {
    const table = this.tables[entity];
    const cur = table.get(req.id);
    const now = this.tick();
    const strip = (r: Row) => ({ ...r }) as Appointment | Client;
    let action: string;
    let row: Row;
    if (!cur) {
      if (req.baseVersion > 0) return { status: 'missing' };
      row = {
        ...(req.data as any), id: req.id, version: 1,
        created_at: now, created_by: user.id, created_by_name: user.name,
        updated_at: now, updated_by: user.id, updated_by_name: user.name,
        last_mutation_id: req.mutationId,
      };
      action = 'create';
    } else {
      if (cur.last_mutation_id === req.mutationId) return { status: 'ok', row: strip(cur) };
      if (cur.version !== req.baseVersion) {
        if (sameData(entity, cur, req.data)) return { status: 'ok', row: strip(cur) };
        return { status: 'conflict', row: strip(cur) };
      }
      const nd = !!(req.data as any).deleted;
      action = nd && !cur.deleted ? 'delete' : cur.deleted && !nd ? 'restore' : 'update';
      row = {
        ...cur, ...(req.data as any), version: cur.version + 1,
        updated_at: now, updated_by: user.id, updated_by_name: user.name, last_mutation_id: req.mutationId,
      };
    }
    table.set(req.id, row);
    this.log.push({
      id: this.log.length + 1, entity, entity_id: req.id, action, version: row.version,
      snapshot: { ...row }, mutation_id: req.mutationId, changed_by_name: user.name, changed_at: now,
    });
    queueMicrotask(() => this.notify());
    return { status: 'ok', row: strip(row) };
  }

  pull(entity: Entity, since: string | null) {
    return [...this.tables[entity].values()]
      .filter((r) => !since || (r.updated_at ?? '') >= since)
      .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
      .map((r) => ({ ...r }));
  }
}

/** Conexiunea unui dispozitiv (cu utilizatorul lui) la serverul în memorie. */
export class MemoryRemote implements Remote {
  online = true;
  constructor(public server: MemoryServer, public user: { id: string; name: string }) {}

  private check() {
    if (!this.online) throw new NetworkError();
  }

  async hasSession() {
    this.check();
    return true;
  }

  async pull(entity: Entity, since: string | null) {
    this.check();
    return this.server.pull(entity, since);
  }

  async push(entity: Entity, req: PushRequest) {
    this.check();
    return this.server.push(entity, JSON.parse(JSON.stringify(req)), this.user);
  }

  async pullHistory(afterId: number) {
    this.check();
    return this.server.log.filter((r) => r.id > afterId).map((r) => ({ ...r }));
  }

  async pullStylists() {
    this.check();
    return this.server.stylists.map((s) => ({ ...s }));
  }

  subscribe(onChange: () => void) {
    return this.server.listen(() => this.online && onChange());
  }

  async uploadBackup(name: string, json: string) {
    this.check();
    this.server.backups.set(name, json);
  }
}
