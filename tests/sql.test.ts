/**
 * Testează schema reală (supabase/migrations/0001_schema.sql) pe un motor
 * PostgreSQL (PGlite), cu un mic "stub" pentru schema auth din Supabase.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const schema = readFileSync(new URL('../supabase/migrations/0001_schema.sql', import.meta.url), 'utf8');

const DIANA = '11111111-1111-1111-1111-111111111111';
const COLEGA = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

let db: PGlite;

async function as(uid: string | null) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}

async function pushAppt(id: string, base: number, data: Record<string, unknown>, mutation = randomUUID()) {
  const r = await db.query<{ r: any }>(
    'select public.push_appointment($1, $2, $3, $4::jsonb) as r',
    [id, base, mutation, JSON.stringify(data)],
  );
  return r.rows[0].r as { status: string; row?: any };
}

const base = {
  client_id: null,
  client_name: 'Maria Popescu',
  client_phone: '0722000000',
  stylist_id: 'diana',
  date: '2026-11-02',
  start_min: 600,
  duration_min: 90,
  service: 'Balayage',
  notes: '',
  deleted: false,
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(schema);
  await db.exec(`
    insert into auth.users values ('${DIANA}'), ('${COLEGA}'), ('${STRANGER}');
    insert into public.profiles (id, username, display_name, role, stylist_id) values
      ('${DIANA}', 'diana', 'Diana Avram', 'admin', 'diana'),
      ('${COLEGA}', 'colega', 'Colega', 'user', 'colega');
  `);
});

describe('baza de date centrală', () => {
  it('refuză accesul persoanelor neautorizate', async () => {
    await as(STRANGER);
    await expect(pushAppt(randomUUID(), 0, base)).rejects.toThrow(/Acces interzis/);
    await as(null);
    await expect(pushAppt(randomUUID(), 0, base)).rejects.toThrow(/Acces interzis/);
  });

  it('creează, modifică și înregistrează autorul și istoricul', async () => {
    await as(DIANA);
    const id = randomUUID();
    const c = await pushAppt(id, 0, base);
    expect(c.status).toBe('ok');
    expect(c.row.version).toBe(1);
    expect(c.row.created_by_name).toBe('Diana Avram');

    await as(COLEGA);
    const u = await pushAppt(id, 1, { ...base, start_min: 660 });
    expect(u.status).toBe('ok');
    expect(u.row.version).toBe(2);
    expect(u.row.updated_by_name).toBe('Colega');
    expect(u.row.created_by_name).toBe('Diana Avram');

    const log = await db.query<{ action: string; changed_by_name: string }>(
      'select action, changed_by_name from public.change_log where entity_id = $1 order by id', [id]);
    expect(log.rows).toEqual([
      { action: 'create', changed_by_name: 'Diana Avram' },
      { action: 'update', changed_by_name: 'Colega' },
    ]);
  });

  it('permite modificarea programărilor din trecut', async () => {
    await as(COLEGA);
    const id = randomUUID();
    await pushAppt(id, 0, { ...base, date: '2019-03-15' });
    const u = await pushAppt(id, 1, { ...base, date: '2019-03-16', notes: 'corectat' });
    expect(u.status).toBe('ok');
    expect(u.row.date).toMatch(/2019-03-16/);
  });

  it('detectează conflictul când două persoane modifică aceeași versiune', async () => {
    await as(DIANA);
    const id = randomUUID();
    await pushAppt(id, 0, base);
    const a = await pushAppt(id, 1, { ...base, notes: 'Diana offline' });
    expect(a.status).toBe('ok');
    await as(COLEGA);
    const b = await pushAppt(id, 1, { ...base, notes: 'Colega offline' });
    expect(b.status).toBe('conflict');
    expect(b.row.notes).toBe('Diana offline');
    expect(b.row.version).toBe(2);
    // rezolvare "păstrez varianta mea" = retrimitere pe versiunea curentă
    const c = await pushAppt(id, 2, { ...base, notes: 'Colega offline' });
    expect(c.status).toBe('ok');
    expect(c.row.version).toBe(3);
  });

  it('nu raportează conflict dacă datele sunt identice', async () => {
    await as(DIANA);
    const id = randomUUID();
    await pushAppt(id, 0, base);
    await pushAppt(id, 1, { ...base, notes: 'x' });
    const r = await pushAppt(id, 1, { ...base, notes: 'x' });
    expect(r.status).toBe('ok');
  });

  it('reîncercarea aceleiași modificări nu creează dubluri', async () => {
    await as(DIANA);
    const id = randomUUID();
    const m = randomUUID();
    await pushAppt(id, 0, base, m);
    const again = await pushAppt(id, 0, base, m);
    expect(again.status).toBe('ok');
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.appointments where id = $1', [id]);
    expect(n.rows[0].n).toBe(1);
  });

  it('ștergerea este reversibilă (soft delete + restore)', async () => {
    await as(DIANA);
    const id = randomUUID();
    await pushAppt(id, 0, base);
    const d = await pushAppt(id, 1, { ...base, deleted: true });
    expect(d.row.deleted).toBe(true);
    const r = await pushAppt(id, 2, { ...base, deleted: false });
    expect(r.row.deleted).toBe(false);
    const log = await db.query<{ action: string }>(
      'select action from public.change_log where entity_id = $1 order by id', [id]);
    expect(log.rows.map((x) => x.action)).toEqual(['create', 'delete', 'restore']);
  });

  it('returnează "missing" pentru o programare ștearsă definitiv', async () => {
    await as(DIANA);
    const r = await pushAppt(randomUUID(), 3, base);
    expect(r.status).toBe('missing');
  });

  it('clientele: modificarea telefonului păstrează istoricul', async () => {
    await as(DIANA);
    const id = randomUUID();
    const q = (base: number, data: object) =>
      db.query<{ r: any }>('select public.push_client($1,$2,$3,$4::jsonb) as r',
        [id, base, randomUUID(), JSON.stringify(data)]).then((x) => x.rows[0].r);
    expect((await q(0, { name: 'Ana', phone: '0711', notes: '' })).status).toBe('ok');
    const u = await q(1, { name: 'Ana', phone: '0799', notes: '' });
    expect(u.row.phone).toBe('0799');
    const log = await db.query('select * from public.change_log where entity_id = $1', [id]);
    expect(log.rows.length).toBe(2);
  });

  it('ștergerea definitivă (GDPR) e permisă doar administratorului', async () => {
    const cid = randomUUID();
    await as(DIANA);
    await db.query('select public.push_client($1,0,$2,$3::jsonb)', [cid, randomUUID(), JSON.stringify({ name: 'De șters' })]);
    const aid = randomUUID();
    await pushAppt(aid, 0, { ...base, client_id: cid });
    await as(COLEGA);
    await expect(db.query('select public.erase_client($1)', [cid])).rejects.toThrow(/administratorul/);
    await as(DIANA);
    await db.query('select public.erase_client($1)', [cid]);
    const left = await db.query('select 1 from public.appointments where id = $1', [aid]);
    expect(left.rows.length).toBe(0);
  });
});
