// Supabase Edge Function: administrarea conturilor (numai pentru administrator).
// Deploy: supabase functions deploy admin-users
// Variabile (setate automat de Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Variabilă de setat: LOGIN_DOMAIN (același ca VITE_LOGIN_DOMAIN din aplicație)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Metodă nepermisă' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const domain = Deno.env.get('LOGIN_DOMAIN') ?? 'agenda.laboratoruldeculoare.ro';

  // 1. cine face cererea? (tokenul utilizatorului conectat)
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: me } = await asUser.auth.getUser();
  if (!me?.user) return json({ error: 'Neautentificat' }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: myProfile } = await admin.from('profiles').select('role, active').eq('id', me.user.id).maybeSingle();
  if (!myProfile || myProfile.role !== 'admin' || !myProfile.active) {
    return json({ error: 'Numai administratorul poate gestiona conturile' }, 403);
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cerere invalidă' }, 400);
  }

  const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 10;

  switch (body.action) {
    case 'list': {
      const { data, error } = await admin.from('profiles').select('*').order('created_at');
      if (error) return json({ error: error.message }, 500);
      return json({ users: data });
    }
    case 'create': {
      const username = String(body.username ?? '').trim().toLowerCase();
      const display = String(body.display_name ?? '').trim();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: 'Utilizator invalid (3–32 caractere: litere mici, cifre, . _ -)' }, 400);
      if (!display) return json({ error: 'Completați numele afișat' }, 400);
      if (!validPassword(body.password)) return json({ error: 'Parola trebuie să aibă cel puțin 10 caractere' }, 400);
      const role = body.role === 'admin' ? 'admin' : 'user';
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}@${domain}`,
        password: body.password,
        email_confirm: true,
        user_metadata: { username, display_name: display },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from('profiles').insert({
        id: data.user.id, username, display_name: display, role, stylist_id: body.stylist_id ?? null,
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: pErr.message }, 400);
      }
      return json({ ok: true });
    }
    case 'set_password': {
      if (!validPassword(body.password)) return json({ error: 'Parola trebuie să aibă cel puțin 10 caractere' }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'update': {
      if (body.user_id === me.user.id && body.active === false) return json({ error: 'Nu vă puteți dezactiva propriul cont' }, 400);
      const patch: Record<string, unknown> = {};
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (typeof body.display_name === 'string' && body.display_name.trim()) patch.display_name = body.display_name.trim();
      if (body.role === 'admin' || body.role === 'user') patch.role = body.role;
      if (typeof body.stylist_id === 'string') patch.stylist_id = body.stylist_id;
      const { error } = await admin.from('profiles').update(patch).eq('id', String(body.user_id));
      if (error) return json({ error: error.message }, 400);
      // cont dezactivat => deconectare forțată (blocare autentificare)
      if (patch.active === false) await admin.auth.admin.updateUserById(String(body.user_id), { ban_duration: '876000h' });
      if (patch.active === true) await admin.auth.admin.updateUserById(String(body.user_id), { ban_duration: 'none' });
      return json({ ok: true });
    }
    default:
      return json({ error: 'Acțiune necunoscută' }, 400);
  }
});
