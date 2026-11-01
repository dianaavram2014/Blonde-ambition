/**
 * Teste pentru: programări suprapuse, modificări în trecut, utilizare offline,
 * sincronizare între două telefoane și conflicte de sincronizare.
 * Fiecare "telefon" are propria bază IndexedDB (fake-indexeddb) și propriul cont.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgendaDB } from '../src/data/db';
import { MemoryRemote, MemoryServer } from '../src/data/memoryRemote';
import { SyncEngine } from '../src/data/sync';
import {
  deleteAppointment, moveAppointment, overlapsFor, restoreAppointment, revertToSnapshot,
  saveAppointment, saveClient, type AppointmentInput,
} from '../src/data/repo';

const DIANA = { id: 'u-diana', name: 'Diana Avram' };
const COLEGA = { id: 'u-colega', name: 'Colega' };

let n = 0;
function device(server: MemoryServer, user: typeof DIANA) {
  const db = new AgendaDB(`test-${++n}`);
  const remote = new MemoryRemote(server, user);
  const engine = new SyncEngine(db, remote, { isOnline: () => remote.online, backups: true });
  return { db, remote, engine, user };
}

const appt = (over: Partial<AppointmentInput> = {}): AppointmentInput => ({
  client_id: null,
  client_name: 'Maria Popescu',
  client_phone: '0722 111 222',
  stylist_id: 'diana',
  date: '2026-11-02',
  start_min: 10 * 60,
  duration_min: 90,
  service: 'Balayage',
  notes: '',
  ...over,
});

let server: MemoryServer;
let diana: ReturnType<typeof device>;
let colega: ReturnType<typeof device>;

beforeEach(() => {
  server = new MemoryServer();
  diana = device(server, DIANA);
  colega = device(server, COLEGA);
});

describe('programări suprapuse', () => {
  it('detectează suprapunerea pentru aceeași stilistă', async () => {
    await saveAppointment(diana.db, appt(), DIANA); // 10:00–11:30
    const o = await overlapsFor(diana.db, { stylist_id: 'diana', date: '2026-11-02', start_min: 11 * 60, duration_min: 30 });
    expect(o).toHaveLength(1);
  });

  it('nu consideră suprapunere programările consecutive', async () => {
    await saveAppointment(diana.db, appt(), DIANA);
    const o = await overlapsFor(diana.db, { stylist_id: 'diana', date: '2026-11-02', start_min: 11 * 60 + 30, duration_min: 30 });
    expect(o).toHaveLength(0);
  });

  it('permite aceeași oră pentru stiliste diferite', async () => {
    await saveAppointment(diana.db, appt(), DIANA);
    const o = await overlapsFor(diana.db, { stylist_id: 'colega', date: '2026-11-02', start_min: 10 * 60, duration_min: 60 });
    expect(o).toHaveLength(0);
  });

  it('ignoră programarea curentă la editare și programările șterse', async () => {
    const id = await saveAppointment(diana.db, appt(), DIANA);
    expect(await overlapsFor(diana.db, { id, stylist_id: 'diana', date: '2026-11-02', start_min: 600, duration_min: 120 })).toHaveLength(0);
    await deleteAppointment(diana.db, id, DIANA);
    expect(await overlapsFor(diana.db, { stylist_id: 'diana', date: '2026-11-02', start_min: 600, duration_min: 60 })).toHaveLength(0);
  });

  it('suprapunerea creată offline de pe două telefoane devine vizibilă pentru ambele', async () => {
    diana.remote.online = false;
    colega.remote.online = false;
    await saveAppointment(diana.db, appt({ client_name: 'Ana', client_phone: '0711' }), DIANA);
    await saveAppointment(colega.db, appt({ client_name: 'Ioana', client_phone: '0733' }), COLEGA);
    diana.remote.online = true;
    colega.remote.online = true;
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    await diana.engine.syncNow();
    const o = await overlapsFor(diana.db, { stylist_id: 'diana', date: '2026-11-02', start_min: 600, duration_min: 15 });
    expect(o).toHaveLength(2);
  });
});

describe('modificări în trecut', () => {
  it('modifică și mută o programare din trecut, iar sincronizarea o transmite', async () => {
    const id = await saveAppointment(diana.db, appt({ date: '2021-05-10' }), DIANA);
    await diana.engine.syncNow();
    await saveAppointment(diana.db, { ...appt({ date: '2021-05-10', notes: 'Formula 7.1 + 6%' }), id }, DIANA);
    await moveAppointment(diana.db, id, { date: '2021-05-11', start_min: 9 * 60, stylist_id: 'colega' }, DIANA);
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    const a = await colega.db.appointments.get(id);
    expect(a).toMatchObject({ date: '2021-05-11', start_min: 540, stylist_id: 'colega', notes: 'Formula 7.1 + 6%', version: 2 }); // cele 2 modificări locale se trimit împreună
    expect(a!.updated_by_name).toBe('Diana Avram');
  });

  it('programările vechi nu dispar niciodată la sincronizare', async () => {
    for (let y = 2018; y <= 2026; y++) await saveAppointment(diana.db, appt({ date: `${y}-01-15` }), DIANA);
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    await colega.engine.syncNow();
    expect(await colega.db.appointments.count()).toBe(9);
  });
});

describe('utilizare offline', () => {
  it('creează, modifică și șterge offline, apoi sincronizează la revenirea internetului', async () => {
    diana.remote.online = false;
    const a = await saveAppointment(diana.db, appt(), DIANA);
    const b = await saveAppointment(diana.db, appt({ client_name: 'Elena', client_phone: '0744', start_min: 720 }), DIANA);
    await saveAppointment(diana.db, { ...appt({ duration_min: 120 }), id: a }, DIANA);
    await deleteAppointment(diana.db, b, DIANA);

    await diana.engine.syncNow();
    expect(diana.engine.status.state).toBe('offline');
    expect(await diana.db.appointments.count()).toBe(2); // date locale păstrate
    expect(await diana.db.outbox.count()).toBeGreaterThan(0);
    expect(server.tables.appointments.size).toBe(0);

    diana.remote.online = true;
    await diana.engine.syncNow();
    expect(diana.engine.status.state).toBe('online');
    expect(await diana.db.outbox.count()).toBe(0);
    expect((server.tables.appointments.get(a) as any).duration_min).toBe(120);
    expect(server.tables.appointments.get(b)!.deleted).toBe(true);

    await colega.engine.syncNow();
    expect((await colega.db.appointments.get(a))!.duration_min).toBe(120);
    expect((await colega.db.appointments.get(b))!.deleted).toBe(true);
  });

  it('reîncercarea după un răspuns pierdut nu creează dubluri', async () => {
    await saveAppointment(diana.db, appt(), DIANA);
    const [client, item] = await diana.db.outbox.orderBy('seq').toArray();
    // simulăm: serverul primește modificările, dar răspunsul nu ajunge pe telefon
    for (const it of [client, item]) {
      server.push(it.entity, { id: it.id, baseVersion: it.baseVersion, mutationId: it.mutationId, data: it.data }, DIANA);
    }
    await diana.engine.syncNow();
    expect(await diana.db.conflicts.count()).toBe(0);
    expect(server.tables.appointments.size).toBe(1);
    expect(server.tables.appointments.get(item.id)!.version).toBe(1);
  });

  it('istoricul local este disponibil offline și devine istoric de server după sincronizare', async () => {
    diana.remote.online = false;
    const id = await saveAppointment(diana.db, appt(), DIANA);
    await saveAppointment(diana.db, { ...appt({ notes: 'x' }), id }, DIANA);
    const local = await diana.db.history.where('entity_id').equals(id).toArray();
    expect(local.map((h) => h.action).sort()).toEqual(['create', 'update']);
    diana.remote.online = true;
    await diana.engine.syncNow();
    const after = await diana.db.history.where('entity_id').equals(id).toArray();
    expect(after.some((h) => h.id.startsWith('s:'))).toBe(true);
  });

  it('o programare ștearsă din greșeală se poate recupera', async () => {
    const id = await saveAppointment(diana.db, appt(), DIANA);
    await diana.engine.syncNow();
    await deleteAppointment(diana.db, id, DIANA);
    await diana.engine.syncNow();
    await restoreAppointment(colega.db, id, COLEGA); // colega nu o are încă local
    await colega.engine.syncNow();
    await restoreAppointment(colega.db, id, COLEGA);
    await colega.engine.syncNow();
    expect(server.tables.appointments.get(id)!.deleted).toBe(false);
    await diana.engine.syncNow();
    expect((await diana.db.appointments.get(id))!.deleted).toBe(false);
  });

  it('revenire la o versiune anterioară din istoric', async () => {
    const id = await saveAppointment(diana.db, appt({ notes: 'v1' }), DIANA);
    await saveAppointment(diana.db, { ...appt({ notes: 'v2' }), id }, DIANA);
    await diana.engine.syncNow();
    const v1 = (await diana.db.history.where('entity_id').equals(id).toArray()).find((h) => h.snapshot.notes === 'v1')!;
    await revertToSnapshot(diana.db, 'appointments', id, v1.snapshot, DIANA);
    await diana.engine.syncNow();
    expect(server.tables.appointments.get(id)!.notes).toBe('v1');
  });
});

describe('conflicte de sincronizare', () => {
  async function shared() {
    const id = await saveAppointment(diana.db, appt(), DIANA);
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    diana.remote.online = false;
    colega.remote.online = false;
    await saveAppointment(diana.db, { ...appt({ start_min: 660, notes: 'mutată de Diana' }), id }, DIANA);
    await saveAppointment(colega.db, { ...appt({ duration_min: 180, notes: 'prelungită de colega' }), id }, COLEGA);
    diana.remote.online = true;
    colega.remote.online = true;
    await diana.engine.syncNow(); // Diana ajunge prima
    await colega.engine.syncNow(); // colega primește conflict
    return id;
  }

  it('detectează conflictul și păstrează ambele variante', async () => {
    const id = await shared();
    const conflicts = await colega.db.conflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0].local as any).notes).toBe('prelungită de colega');
    expect((conflicts[0].server as any).notes).toBe('mutată de Diana');
    // varianta locală NU este suprascrisă până la decizie
    expect((await colega.db.appointments.get(id))!.notes).toBe('prelungită de colega');
    expect(server.tables.appointments.get(id)!.notes).toBe('mutată de Diana');
  });

  it('rezolvare: păstrez varianta mea', async () => {
    const id = await shared();
    const [c] = await colega.db.conflicts.toArray();
    await colega.engine.resolveConflict(c.key, 'local', COLEGA);
    await colega.engine.syncNow();
    expect(await colega.db.conflicts.count()).toBe(0);
    expect(server.tables.appointments.get(id)).toMatchObject({ notes: 'prelungită de colega', duration_min: 180, version: 3 });
    await diana.engine.syncNow();
    expect((await diana.db.appointments.get(id))!.notes).toBe('prelungită de colega');
    // varianta Dianei rămâne în istoric
    expect(server.log.some((l) => l.entity_id === id && (l.snapshot as any).notes === 'mutată de Diana')).toBe(true);
  });

  it('rezolvare: păstrez varianta de pe server, iar varianta mea rămâne în istoric', async () => {
    const id = await shared();
    const [c] = await colega.db.conflicts.toArray();
    await colega.engine.resolveConflict(c.key, 'server', COLEGA);
    await colega.engine.syncNow();
    expect((await colega.db.appointments.get(id))!.notes).toBe('mutată de Diana');
    const rejected = (await colega.db.history.toArray()).find((h) => h.action === 'rejected');
    expect(rejected?.snapshot.notes).toBe('prelungită de colega');
    expect(server.tables.appointments.get(id)!.version).toBe(2);
  });

  it('ștergere offline vs. modificare offline => conflict, nu pierdere de date', async () => {
    const id = await saveAppointment(diana.db, appt(), DIANA);
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    diana.remote.online = colega.remote.online = false;
    await deleteAppointment(diana.db, id, DIANA);
    await saveAppointment(colega.db, { ...appt({ notes: 'important' }), id }, COLEGA);
    diana.remote.online = colega.remote.online = true;
    await colega.engine.syncNow();
    await diana.engine.syncNow();
    expect(await diana.db.conflicts.count()).toBe(1);
    expect(server.tables.appointments.get(id)!.deleted).toBe(false);
  });

  it('modificarea clientei (telefon) nu pierde programările', async () => {
    const id = await saveAppointment(diana.db, appt(), DIANA);
    const a = await diana.db.appointments.get(id);
    await saveClient(diana.db, a!.client_id, { name: 'Maria Popescu', phone: '0799 000 000', notes: 'alergie PPD' }, DIANA);
    await diana.engine.syncNow();
    await colega.engine.syncNow();
    const c = await colega.db.clients.get(a!.client_id!);
    expect(c!.phone).toBe('0799 000 000');
    expect(await colega.db.appointments.where('client_id').equals(c!.id).count()).toBe(1);
  });

  it('recunoaște clienta existentă după numărul de telefon', async () => {
    await saveAppointment(diana.db, appt({ client_phone: '0722 111 222' }), DIANA);
    await saveAppointment(diana.db, appt({ client_phone: '+40 722-111-222', date: '2026-12-01' }), DIANA);
    expect(await diana.db.clients.count()).toBe(1);
  });
});

describe('backup', () => {
  it('face backup automat în cloud după sincronizare', async () => {
    await saveAppointment(diana.db, appt(), DIANA);
    await diana.engine.syncNow();
    expect(server.backups.size).toBe(1);
    const json = JSON.parse([...server.backups.values()][0]);
    expect(json.appointments).toHaveLength(1);
  });
});
