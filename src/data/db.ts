import Dexie, { type Table } from 'dexie';
import type { Appointment, Client, Conflict, HistoryEntry, OutboxItem, Stylist } from '../lib/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Baza de date locală persistentă (IndexedDB). Aici stă o copie completă a
 * agendei, astfel încât aplicația funcționează integral fără internet.
 */
export class AgendaDB extends Dexie {
  appointments!: Table<Appointment, string>;
  clients!: Table<Client, string>;
  stylists!: Table<Stylist, string>;
  outbox!: Table<OutboxItem, string>;
  conflicts!: Table<Conflict, string>;
  history!: Table<HistoryEntry, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'laborator-agenda') {
    super(name);
    this.version(1).stores({
      appointments: 'id, date, client_id, stylist_id, deleted, updated_at',
      clients: 'id, name, phone, deleted',
      stylists: 'id, sort',
      outbox: 'key, seq, entity, id',
      conflicts: 'key, entity, id',
      history: 'id, entity_id, changed_at, mutation_id, pending',
      meta: 'key',
    });
  }

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const row = await this.meta.get(key);
    return row ? (row.value as T) : fallback;
  }

  async setMeta(key: string, value: unknown) {
    await this.meta.put({ key, value });
  }

  async wipe() {
    await this.transaction('rw', [this.appointments, this.clients, this.stylists, this.outbox, this.conflicts, this.history, this.meta], async () => {
      await Promise.all([
        this.appointments.clear(), this.clients.clear(), this.stylists.clear(), this.outbox.clear(),
        this.conflicts.clear(), this.history.clear(), this.meta.clear(),
      ]);
    });
  }
}

export const DEFAULT_STYLISTS: Stylist[] = [
  { id: 'diana', name: 'Diana', color: '#C9A96E', sort: 1, active: true },
  { id: 'colega', name: 'Colega', color: '#9DB4C0', sort: 2, active: true },
];

export function uuid(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // rezervă pentru browsere vechi
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
