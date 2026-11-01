import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment, Client, Entity, Stylist } from '../lib/types';
import { AuthError, NetworkError, type PushRequest, type PushResult, type Remote, type RemoteHistoryRow } from './remote';

const PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000; // re-citim ultimele 2 minute (îmbinarea e idempotentă)

function classify(error: any): Error {
  const msg = String(error?.message ?? error ?? '');
  const status = Number(error?.status ?? error?.code ?? 0);
  if (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(msg)
  ) {
    return new NetworkError();
  }
  if (status === 401 || error?.code === 'PGRST301' || /jwt|not authenticated|refresh token/i.test(msg)) {
    return new AuthError();
  }
  return new Error(msg || 'Eroare necunoscută la server');
}

export class SupabaseRemote implements Remote {
  constructor(private sb: SupabaseClient) {}

  async hasSession() {
    try {
      const { data, error } = await this.sb.auth.getSession();
      if (error) throw error;
      if (!data.session) return false;
      // tokenul expirat se reînnoiește automat; dacă nu se poate (offline) => NetworkError
      if ((data.session.expires_at ?? 0) * 1000 < Date.now()) {
        const r = await this.sb.auth.refreshSession();
        if (r.error) throw r.error;
        return !!r.data.session;
      }
      return true;
    } catch (e) {
      throw classify(e);
    }
  }

  async pull(entity: Entity, since: string | null): Promise<(Appointment | Client)[]> {
    const out: (Appointment | Client)[] = [];
    const from = since ? new Date(Date.parse(since) - OVERLAP_MS).toISOString() : null;
    for (let offset = 0; ; offset += PAGE) {
      let q = this.sb.from(entity).select('*').order('updated_at', { ascending: true }).order('id').range(offset, offset + PAGE - 1);
      if (from) q = q.gte('updated_at', from);
      const { data, error } = await q;
      if (error) throw classify(error);
      out.push(...((data ?? []) as any));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async push(entity: Entity, req: PushRequest): Promise<PushResult> {
    const fn = entity === 'appointments' ? 'push_appointment' : 'push_client';
    const { data, error } = await this.sb.rpc(fn, {
      p_id: req.id,
      p_base_version: req.baseVersion,
      p_mutation_id: req.mutationId,
      p_data: req.data,
    });
    if (error) throw classify(error);
    return data as PushResult;
  }

  async pullHistory(afterId: number): Promise<RemoteHistoryRow[]> {
    const out: RemoteHistoryRow[] = [];
    let cursor = afterId;
    for (;;) {
      const { data, error } = await this.sb.from('change_log').select('*').gt('id', cursor).order('id').limit(PAGE);
      if (error) throw classify(error);
      const rows = (data ?? []) as RemoteHistoryRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1].id;
    }
    return out;
  }

  async pullStylists(): Promise<Stylist[]> {
    const { data, error } = await this.sb.from('stylists').select('*').order('sort');
    if (error) throw classify(error);
    return (data ?? []) as Stylist[];
  }

  subscribe(onChange: () => void) {
    const ch = this.sb
      .channel('agenda-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stylists' }, onChange)
      .subscribe();
    return () => {
      void this.sb.removeChannel(ch);
    };
  }

  async uploadBackup(name: string, json: string) {
    const { error } = await this.sb.storage
      .from('backups')
      .upload(name, new Blob([json], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
    if (error) throw classify(error);
  }
}
