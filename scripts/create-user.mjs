#!/usr/bin/env node
// Creează în siguranță un cont (prima dată: contul de administrator al Dianei).
// Rulare:  npm run create-user
// Necesită în fișierul .env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_LOGIN_DOMAIN
// Parola se introduce de la tastatură (nu apare pe ecran și nu se salvează nicăieri în cod).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.VITE_LOGIN_DOMAIN || 'agenda.laboratoruldeculoare.ro';
if (!url || !serviceKey) {
  console.error('Lipsesc VITE_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY în .env');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
function askHidden(q) {
  return new Promise((resolve) => {
    const out = rl.output;
    const orig = rl._writeToOutput;
    rl._writeToOutput = (s) => (s.includes(q) ? out.write(s) : out.write('*'));
    rl.question(q, (a) => {
      rl._writeToOutput = orig;
      out.write('\n');
      resolve(a);
    });
  });
}

const username = (await ask('Utilizator (ex.: diana): ')).toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.error('Utilizator invalid.'); process.exit(1); }
const display = await ask('Nume afișat (ex.: Diana Avram): ');
const role = (await ask('Rol – admin / user [user]: ')) === 'admin' ? 'admin' : 'user';
const stylist = (await ask('Coloana din agendă – diana / colega [diana]: ')) || 'diana';
const pass = await askHidden('Parolă (min. 10 caractere): ');
const pass2 = await askHidden('Repetați parola: ');
rl.close();
if (pass.length < 10) { console.error('Parola este prea scurtă.'); process.exit(1); }
if (pass !== pass2) { console.error('Parolele nu coincid.'); process.exit(1); }

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.createUser({
  email: `${username}@${domain}`, password: pass, email_confirm: true,
  user_metadata: { username, display_name: display },
});
if (error) { console.error('Eroare:', error.message); process.exit(1); }
const { error: pErr } = await sb.from('profiles').insert({ id: data.user.id, username, display_name: display || username, role, stylist_id: stylist });
if (pErr) {
  await sb.auth.admin.deleteUser(data.user.id);
  console.error('Eroare profil:', pErr.message);
  process.exit(1);
}
console.log(`✓ Contul „${username}” (${role}) a fost creat. Conectare în aplicație cu utilizatorul „${username}”.`);
