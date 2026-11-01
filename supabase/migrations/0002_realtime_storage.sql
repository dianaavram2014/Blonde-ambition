-- ============================================================================
-- Actualizări în timp real + spațiu privat pentru backup-uri automate
-- (specific Supabase; rulați după 0001_schema.sql)
-- ============================================================================

-- Realtime: notificări instant când colega modifică ceva
do $$
begin
  begin
    alter publication supabase_realtime add table public.appointments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.clients;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.stylists;
  exception when duplicate_object then null;
  end;
end $$;

-- Bucket PRIVAT pentru backup-uri zilnice (JSON). Nu este accesibil public.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists backups_staff_read on storage.objects;
create policy backups_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_staff());

drop policy if exists backups_staff_insert on storage.objects;
create policy backups_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and public.is_staff());

drop policy if exists backups_staff_update on storage.objects;
create policy backups_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'backups' and public.is_staff())
  with check (bucket_id = 'backups' and public.is_staff());
