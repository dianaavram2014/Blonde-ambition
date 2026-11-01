import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) || 'agenda.laboratoruldeculoare.ro';

export const isConfigured = !!(url && key);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lc-agenda-auth' },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

/** "diana" => "diana@<domeniu>"; o adresă de e-mail completă rămâne neschimbată. */
export function usernameToEmail(username: string): string {
  const u = username.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
}
