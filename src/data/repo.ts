import type { AgendaDB } from './db';
import { uuid } from './db';
import { nextSeq } from './sync';
import type {
  Appointment, AppointmentData, Client, ClientData, CurrentUser, Entity, HistoryAction,
} from '../lib/types';
import { pickData } from '../lib/types';
import { findOverlaps } from '../lib/overlap';
import { normalize, normalizePhone } from '../lib/services';

/**
 * Toate modificările trec pe aici: se salvează IMEDIAT în baza locală
 * (funcționează offline), se pun în coada de sincronizare și se notează în istoric.
 */
async function mutate(
  db: AgendaDB,
  entity: Entity,
  id: string,
  data: AppointmentData | ClientData,
  user: CurrentUser,
  action: HistoryAction,
) {
  const table = entity === 'appointments' ? db.appointments : db.clients;
  const key = `${entity}:${id}`;
  const now = new Date().toISOString();
  await db.transaction('rw', [table, db.outbox, db.history, db.conflicts, db.meta], async () => {
    const existingRow = (await table.get(id)) as (Appointment | Client) | undefined;
    const defaults = existingRow ?? { created_at: now, created_by: user.id, created_by_name: user.name, version: 0 };
    const row = {
      ...defaults,
      ...data,
      id,
      updated_at: now,
      updated_by: user.id,
      updated_by_name: user.name,
    };
    await table.put(row as any);

    const mutationId = uuid();
    await db.history.put({
      id: `l:${mutationId}`,
      entity,
      entity_id: id,
      action,
      version: null,
      snapshot: row as any,
      mutation_id: mutationId,
      changed_by_name: user.name,
      changed_at: now,
      pending: 1,
    });

    const conflict = await db.conflicts.get(key);
    if (conflict) {
      // există un conflict nerezolvat: actualizăm varianta locală a conflictului
      await db.conflicts.update(key, { local: data, localBy: user.name });
      return;
    }

    const pending = await db.outbox.get(key);
    await db.outbox.put({
      key,
      entity,
      id,
      baseVersion: pending ? pending.baseVersion : existingRow?.version ?? 0,
      mutationId,
      data,
      seq: pending ? pending.seq : await nextSeq(db),
      createdAt: pending ? pending.createdAt : now,
    });
  });
}

export interface AppointmentInput {
  id?: string;
  client_id: string | null;
  client_name: string;
  client_phone: string;
  stylist_id: string;
  date: string;
  start_min: number;
  duration_min: number;
  service: string;
  notes: string;
}

/** Găsește clienta existentă (după telefon) sau o creează; actualizează datele ei dacă s-au schimbat. */
async function resolveClient(db: AgendaDB, input: AppointmentInput, user: CurrentUser): Promise<string> {
  const name = input.client_name.trim();
  const phone = input.client_phone.trim();
  if (input.client_id) {
    const c = await db.clients.get(input.client_id);
    if (c) {
      if (c.name !== name || c.phone !== phone || c.deleted) {
        await mutate(db, 'clients', c.id, { ...pickData('clients', c) as ClientData, name, phone, deleted: false }, user, 'update');
      }
      return c.id;
    }
  }
  const all = await db.clients.toArray();
  const np = normalizePhone(phone);
  let match: Client | undefined;
  if (np.length >= 6) match = all.find((c) => !c.deleted && normalizePhone(c.phone) === np);
  if (!match && !np) match = all.find((c) => !c.deleted && !c.phone && normalize(c.name) === normalize(name));
  if (match) return match.id; // clientă existentă (după telefon) – fișa ei nu se modifică automat
  const id = uuid();
  await mutate(db, 'clients', id, { name, phone, notes: '', deleted: false }, user, 'create');
  return id;
}

export function validateAppointment(input: AppointmentInput): string | null {
  if (!input.client_name.trim()) return 'Completați numele clientei.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Data nu este validă.';
  if (!(input.duration_min >= 5 && input.duration_min <= 1440)) return 'Durata trebuie să fie între 5 minute și 24 de ore.';
  if (!(input.start_min >= 0 && input.start_min < 1440)) return 'Ora de început nu este validă.';
  if (!input.stylist_id) return 'Alegeți stilista.';
  return null;
}

export async function saveAppointment(db: AgendaDB, input: AppointmentInput, user: CurrentUser): Promise<string> {
  const err = validateAppointment(input);
  if (err) throw new Error(err);
  const clientId = await resolveClient(db, input, user);
  const id = input.id ?? uuid();
  const existing = input.id ? await db.appointments.get(input.id) : undefined;
  const data: AppointmentData = {
    client_id: clientId,
    client_name: input.client_name.trim(),
    client_phone: input.client_phone.trim(),
    stylist_id: input.stylist_id,
    date: input.date,
    start_min: Math.round(input.start_min),
    duration_min: Math.round(input.duration_min),
    service: input.service.trim(),
    notes: input.notes.trim(),
    deleted: false,
  };
  await mutate(db, 'appointments', id, data, user, existing ? (existing.deleted ? 'restore' : 'update') : 'create');
  return id;
}

/** Mutare rapidă (drag & drop): altă zi, altă oră sau altă stilistă. */
export async function moveAppointment(
  db: AgendaDB, id: string, to: { date: string; start_min: number; stylist_id: string }, user: CurrentUser,
) {
  const a = await db.appointments.get(id);
  if (!a) throw new Error('Programarea nu există.');
  await mutate(db, 'appointments', id, { ...(pickData('appointments', a) as AppointmentData), ...to }, user, 'update');
}

export async function deleteAppointment(db: AgendaDB, id: string, user: CurrentUser) {
  const a = await db.appointments.get(id);
  if (!a) return;
  await mutate(db, 'appointments', id, { ...(pickData('appointments', a) as AppointmentData), deleted: true }, user, 'delete');
}

export async function restoreAppointment(db: AgendaDB, id: string, user: CurrentUser) {
  const a = await db.appointments.get(id);
  if (!a) return;
  await mutate(db, 'appointments', id, { ...(pickData('appointments', a) as AppointmentData), deleted: false }, user, 'restore');
}

/** Revenire la o versiune anterioară din istoric. */
export async function revertToSnapshot(
  db: AgendaDB, entity: Entity, id: string, snapshot: Record<string, any>, user: CurrentUser,
) {
  const table = entity === 'appointments' ? db.appointments : db.clients;
  const current = await table.get(id);
  const data = { ...(current ? pickData(entity, current) : {}), ...pickData(entity, snapshot), deleted: false };
  if (entity === 'appointments') {
    const a = data as AppointmentData;
    a.date = String(a.date).slice(0, 10);
    a.client_id = a.client_id ?? null;
  }
  await mutate(db, entity, id, data as any, user, current?.deleted ? 'restore' : 'update');
}

export async function saveClient(db: AgendaDB, id: string | null, data: Omit<ClientData, 'deleted'>, user: CurrentUser) {
  const clean: ClientData = { name: data.name.trim(), phone: data.phone.trim(), notes: data.notes.trim(), deleted: false };
  if (!clean.name) throw new Error('Completați numele clientei.');
  const existing = id ? await db.clients.get(id) : undefined;
  const cid = id ?? uuid();
  await mutate(db, 'clients', cid, clean, user, existing ? 'update' : 'create');
  return cid;
}

export async function overlapsFor(db: AgendaDB, candidate: Pick<AppointmentData, 'stylist_id' | 'date' | 'start_min' | 'duration_min'> & { id?: string }) {
  const sameDay = await db.appointments.where('date').equals(candidate.date).toArray();
  return findOverlaps({ ...candidate, id: candidate.id ?? '__new__', deleted: false }, sameDay);
}
