-- ============================================================================
-- Laboratorul de Culoare – Smart Agenda
-- Schema bazei de date centrale (Supabase / PostgreSQL)
--
-- Principii:
--  * Toate scrierile trec prin funcțiile push_appointment / push_client, care
--    verifică versiunea (detectare conflicte), incrementează versiunea,
--    înregistrează autorul și scriu automat în jurnalul de modificări.
--  * Ștergerea este "soft" (deleted = true) => orice programare se poate recupera.
--  * Accesul este permis NUMAI conturilor active din tabela profiles (RLS).
-- ============================================================================


-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique,
  display_name text not null,
  role         text not null default 'user' check (role in ('admin', 'user')),
  stylist_id   text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- stylists --
create table if not exists public.stylists (
  id         text primary key,
  name       text not null,
  color      text not null default '#E9DCC0',
  sort       int  not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.stylists (id, name, color, sort) values
  ('diana',  'Diana',  '#C9A96E', 1),
  ('colega', 'Colega', '#9DB4C0', 2)
on conflict (id) do nothing;

-- ----------------------------------------------------------------- clients --
create table if not exists public.clients (
  id               uuid primary key,
  name             text not null check (length(trim(name)) > 0),
  phone            text not null default '',
  notes            text not null default '',
  deleted          boolean not null default false,
  version          int  not null default 1,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text,
  last_mutation_id uuid
);
create index if not exists clients_updated_at_idx on public.clients (updated_at);
create index if not exists clients_phone_idx on public.clients (phone);

-- ------------------------------------------------------------ appointments --
create table if not exists public.appointments (
  id               uuid primary key,
  client_id        uuid,               -- referință "soft" către clients.id
  client_name      text not null check (length(trim(client_name)) > 0),
  client_phone     text not null default '',
  stylist_id       text not null,
  date             date not null,
  start_min        int  not null check (start_min between 0 and 1439),
  duration_min     int  not null check (duration_min between 5 and 1440),
  service          text not null default '',
  notes            text not null default '',
  deleted          boolean not null default false,
  version          int  not null default 1,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text,
  last_mutation_id uuid
);
create index if not exists appointments_updated_at_idx on public.appointments (updated_at);
create index if not exists appointments_date_idx on public.appointments (date);
create index if not exists appointments_client_idx on public.appointments (client_id);

-- -------------------------------------------------------------- change_log --
create table if not exists public.change_log (
  id              bigserial primary key,
  entity          text not null check (entity in ('appointments', 'clients')),
  entity_id       uuid not null,
  action          text not null,   -- create | update | delete | restore
  version         int,
  snapshot        jsonb not null,
  mutation_id     uuid,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index if not exists change_log_entity_idx on public.change_log (entity_id);

-- ================================================================ helpers ==
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ======================================================= push_appointment ==
-- Aplică o modificare venită de pe un dispozitiv.
--   p_base_version = versiunea de la care a pornit modificarea (0 = programare nouă)
--   p_mutation_id  = ID unic al modificării (permite reîncercări fără dubluri)
-- Răspuns: {"status":"ok","row":{...}} | {"status":"conflict","row":{...}} | {"status":"missing"}
create or replace function public.push_appointment(
  p_id uuid, p_base_version int, p_mutation_id uuid, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur    public.appointments;
  uid    uuid := auth.uid();
  uname  text;
  act    text;
  n_deleted boolean := coalesce((p_data->>'deleted')::boolean, false);
begin
  if not public.is_staff() then
    raise exception 'Acces interzis' using errcode = '42501';
  end if;
  select display_name into uname from public.profiles where id = uid;

  select * into cur from public.appointments where id = p_id for update;

  if not found then
    if coalesce(p_base_version, 0) > 0 then
      return jsonb_build_object('status', 'missing');
    end if;
    insert into public.appointments (
      id, client_id, client_name, client_phone, stylist_id, date, start_min,
      duration_min, service, notes, deleted, version,
      created_by, created_by_name, updated_by, updated_by_name, last_mutation_id)
    values (
      p_id, nullif(p_data->>'client_id', '')::uuid, p_data->>'client_name',
      coalesce(p_data->>'client_phone', ''), p_data->>'stylist_id',
      (p_data->>'date')::date, (p_data->>'start_min')::int,
      (p_data->>'duration_min')::int, coalesce(p_data->>'service', ''),
      coalesce(p_data->>'notes', ''), n_deleted, 1,
      uid, uname, uid, uname, p_mutation_id)
    returning * into cur;
    insert into public.change_log (entity, entity_id, action, version, snapshot, mutation_id, changed_by, changed_by_name)
    values ('appointments', cur.id, 'create', cur.version, to_jsonb(cur), p_mutation_id, uid, uname);
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;

  -- reîncercare a aceleiași modificări (răspunsul anterior s-a pierdut)
  if cur.last_mutation_id is not distinct from p_mutation_id then
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;

  if cur.version <> coalesce(p_base_version, 0) then
    -- versiunea de pe server s-a schimbat între timp. Dacă datele sunt identice
    -- nu este un conflict real.
    if cur.client_id is not distinct from nullif(p_data->>'client_id', '')::uuid
       and cur.client_name = p_data->>'client_name'
       and cur.client_phone = coalesce(p_data->>'client_phone', '')
       and cur.stylist_id = p_data->>'stylist_id'
       and cur.date = (p_data->>'date')::date
       and cur.start_min = (p_data->>'start_min')::int
       and cur.duration_min = (p_data->>'duration_min')::int
       and cur.service = coalesce(p_data->>'service', '')
       and cur.notes = coalesce(p_data->>'notes', '')
       and cur.deleted = n_deleted then
      return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
    end if;
    return jsonb_build_object('status', 'conflict', 'row', to_jsonb(cur));
  end if;

  act := case
           when n_deleted and not cur.deleted then 'delete'
           when cur.deleted and not n_deleted then 'restore'
           else 'update' end;

  update public.appointments set
    client_id       = nullif(p_data->>'client_id', '')::uuid,
    client_name     = p_data->>'client_name',
    client_phone    = coalesce(p_data->>'client_phone', ''),
    stylist_id      = p_data->>'stylist_id',
    date            = (p_data->>'date')::date,
    start_min       = (p_data->>'start_min')::int,
    duration_min    = (p_data->>'duration_min')::int,
    service         = coalesce(p_data->>'service', ''),
    notes           = coalesce(p_data->>'notes', ''),
    deleted         = n_deleted,
    version         = cur.version + 1,
    updated_at      = now(),
    updated_by      = uid,
    updated_by_name = uname,
    last_mutation_id = p_mutation_id
  where id = p_id
  returning * into cur;

  insert into public.change_log (entity, entity_id, action, version, snapshot, mutation_id, changed_by, changed_by_name)
  values ('appointments', cur.id, act, cur.version, to_jsonb(cur), p_mutation_id, uid, uname);
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end;
$$;

-- ============================================================ push_client ==
create or replace function public.push_client(
  p_id uuid, p_base_version int, p_mutation_id uuid, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur   public.clients;
  uid   uuid := auth.uid();
  uname text;
  act   text;
  n_deleted boolean := coalesce((p_data->>'deleted')::boolean, false);
begin
  if not public.is_staff() then
    raise exception 'Acces interzis' using errcode = '42501';
  end if;
  select display_name into uname from public.profiles where id = uid;

  select * into cur from public.clients where id = p_id for update;

  if not found then
    if coalesce(p_base_version, 0) > 0 then
      return jsonb_build_object('status', 'missing');
    end if;
    insert into public.clients (id, name, phone, notes, deleted, version,
      created_by, created_by_name, updated_by, updated_by_name, last_mutation_id)
    values (p_id, p_data->>'name', coalesce(p_data->>'phone', ''),
      coalesce(p_data->>'notes', ''), n_deleted, 1, uid, uname, uid, uname, p_mutation_id)
    returning * into cur;
    insert into public.change_log (entity, entity_id, action, version, snapshot, mutation_id, changed_by, changed_by_name)
    values ('clients', cur.id, 'create', cur.version, to_jsonb(cur), p_mutation_id, uid, uname);
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;

  if cur.last_mutation_id is not distinct from p_mutation_id then
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;

  if cur.version <> coalesce(p_base_version, 0) then
    if cur.name = p_data->>'name'
       and cur.phone = coalesce(p_data->>'phone', '')
       and cur.notes = coalesce(p_data->>'notes', '')
       and cur.deleted = n_deleted then
      return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
    end if;
    return jsonb_build_object('status', 'conflict', 'row', to_jsonb(cur));
  end if;

  act := case
           when n_deleted and not cur.deleted then 'delete'
           when cur.deleted and not n_deleted then 'restore'
           else 'update' end;

  update public.clients set
    name = p_data->>'name',
    phone = coalesce(p_data->>'phone', ''),
    notes = coalesce(p_data->>'notes', ''),
    deleted = n_deleted,
    version = cur.version + 1,
    updated_at = now(),
    updated_by = uid,
    updated_by_name = uname,
    last_mutation_id = p_mutation_id
  where id = p_id
  returning * into cur;

  insert into public.change_log (entity, entity_id, action, version, snapshot, mutation_id, changed_by, changed_by_name)
  values ('clients', cur.id, act, cur.version, to_jsonb(cur), p_mutation_id, uid, uname);
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end;
$$;

-- ===================================================== GDPR: erase_client ==
-- Ștergere DEFINITIVĂ a datelor unei cliente (dreptul de a fi uitat).
-- Numai administratorul. Elimină clienta, programările ei și jurnalul aferent.
create or replace function public.erase_client(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Numai administratorul poate șterge definitiv datele' using errcode = '42501';
  end if;
  delete from public.change_log
   where entity_id = p_id
      or entity_id in (select id from public.appointments where client_id = p_id);
  delete from public.appointments where client_id = p_id;
  delete from public.clients where id = p_id;
  insert into public.change_log (entity, entity_id, action, snapshot, changed_by, changed_by_name)
  values ('clients', p_id, 'erase', '{}'::jsonb, auth.uid(),
          (select display_name from public.profiles where id = auth.uid()));
end;
$$;

-- ================================================================== RLS ====
alter table public.profiles     enable row level security;
alter table public.stylists     enable row level security;
alter table public.clients      enable row level security;
alter table public.appointments enable row level security;
alter table public.change_log   enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_staff());

drop policy if exists stylists_read on public.stylists;
create policy stylists_read on public.stylists for select to authenticated
  using (public.is_staff());
drop policy if exists stylists_admin_write on public.stylists;
create policy stylists_admin_write on public.stylists for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Citire: numai personalul activ. Scriere: numai prin funcțiile push_* (fără politici de insert/update).
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using (public.is_staff());

drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
  using (public.is_staff());

drop policy if exists change_log_read on public.change_log;
create policy change_log_read on public.change_log for select to authenticated
  using (public.is_staff());

-- Funcțiile pot fi apelate doar de utilizatori autentificați
revoke all on function public.push_appointment(uuid, int, uuid, jsonb) from public, anon;
revoke all on function public.push_client(uuid, int, uuid, jsonb) from public, anon;
revoke all on function public.erase_client(uuid) from public, anon;
grant execute on function public.push_appointment(uuid, int, uuid, jsonb) to authenticated;
grant execute on function public.push_client(uuid, int, uuid, jsonb) to authenticated;
grant execute on function public.erase_client(uuid) to authenticated;
