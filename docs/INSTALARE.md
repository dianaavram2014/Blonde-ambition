# Instalare pas cu pas – Laboratorul de Culoare · Smart Agenda

Timp estimat: **45–60 de minute**, o singură dată. Nu este nevoie să știți programare –
urmați pașii exact în ordine. Unde scrie „copiați”, folosiți copy/paste.

---

## Ce servicii externe sunt necesare și cât costă

| Serviciu | La ce folosește | Cost |
|---|---|---|
| **Supabase** (supabase.com) | Baza de date centrală, conturile, sincronizarea în timp real, spațiul pentru backup | **Gratuit** (planul Free) pentru un salon cu 2 persoane. Opțional **Pro – aprox. 25 USD/lună**: backup automat zilnic al întregii baze, fără pauză la inactivitate. |
| **Vercel** (vercel.com) *sau* Netlify | Publicarea aplicației la o adresă web securizată (HTTPS) | **Gratuit** (planul Hobby / Starter) |
| **GitHub** (github.com) | Păstrarea codului sursă (deja îl aveți) | **Gratuit** |
| Domeniu propriu (opțional) | ex. `agenda.laboratoruldeculoare.ro` în loc de `xxx.vercel.app` | aprox. 10–15 EUR/an |

> Prețurile se pot schimba – verificați pe site-urile furnizorilor.
>
> **Atenție – planul gratuit Supabase:** un proiect care nu este folosit **deloc** timp de 7 zile
> este pus pe pauză (se reactivează cu un click din panoul Supabase; datele nu se pierd).
> Cu folosire zilnică, acest lucru nu se întâmplă. Planul gratuit nu include backup automat al
> bazei de date de către Supabase – de aceea aplicația face **singură** un backup zilnic (JSON)
> în spațiul privat „backups”, iar din Setări puteți descărca oricând un backup complet.

**Ce trebuie să faceți dumneavoastră:** să creați conturile la Supabase și Vercel (cu e-mailul
salonului), să copiați câteva chei și să creați cele două conturi de utilizator. Totul este descris mai jos.

---

## Pasul 1 – Creați baza de date (Supabase)

1. Intrați pe **https://supabase.com** → *Start your project* → autentificare cu GitHub sau e-mail.
2. *New project*:
   - **Name:** `laborator-agenda`
   - **Database Password:** apăsați *Generate a password* și **salvați-o** într-un loc sigur (ex. Keychain/Parole pe iPhone).
   - **Region:** `Central EU (Frankfurt)` – datele rămân în UE (GDPR).
   - *Create new project* și așteptați ~2 minute.
3. În meniul din stânga: **SQL Editor** → *New query*.
   - Deschideți fișierul [`supabase/migrations/0001_schema.sql`](../supabase/migrations/0001_schema.sql) din acest proiect, copiați **tot** conținutul, lipiți-l și apăsați **Run**. Trebuie să apară „Success”.
   - Repetați cu [`supabase/migrations/0002_realtime_storage.sql`](../supabase/migrations/0002_realtime_storage.sql).
4. **Securitate – opriți înregistrarea liberă:** *Authentication* → *Sign In / Providers* (sau *Providers → Email*):
   - **dezactivați „Allow new users to sign up”** (conturile le creați doar dumneavoastră);
   - lăsați Email activ; „Confirm email” nu contează (conturile se creează deja confirmate).
5. Copiați cheile: *Project Settings* → *API* (sau *Data API* / *API Keys*):
   - **Project URL** – ex. `https://abcdefgh.supabase.co`
   - cheia **anon / publishable** (publică – poate sta în aplicație, datele sunt protejate de reguli RLS)
   - cheia **service_role / secret** – **SECRETĂ**: nu o trimiteți nimănui, nu o puneți pe site. O folosiți doar la Pasul 3 pe calculatorul dumneavoastră.

## Pasul 2 – Pregătiți proiectul pe MacBook

1. Instalați **Node.js** (versiunea LTS) de pe https://nodejs.org (fișier .pkg, Next → Next).
2. Deschideți aplicația **Terminal** și rulați (pe rând):
   ```bash
   git clone https://github.com/dianaavram2014/blonde-ambition.git
   cd blonde-ambition
   npm install
   cp .env.example .env
   open -e .env
   ```
3. În fișierul `.env` care s-a deschis completați:
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co        ← Project URL
   VITE_SUPABASE_ANON_KEY=eyJ...                         ← cheia anon / publishable
   VITE_LOGIN_DOMAIN=agenda.laboratoruldeculoare.ro      ← lăsați așa
   SUPABASE_SERVICE_ROLE_KEY=eyJ...                      ← cheia service_role (doar local!)
   ```
   Salvați (⌘S). Fișierul `.env` **nu** se urcă pe GitHub (este exclus automat).

## Pasul 3 – Creați cele două conturi (în siguranță)

În Terminal, în dosarul proiectului:

```bash
npm run create-user
```

Răspundeți la întrebări:

| | Diana (administrator) | Colega |
|---|---|---|
| Utilizator | `diana` | ex. `ioana` |
| Nume afișat | `Diana Avram` | ex. `Ioana Popa` |
| Rol | `admin` | `user` |
| Coloana din agendă | `diana` | `colega` |
| Parolă | minimum 10 caractere, scrisă de dumneavoastră | minimum 10 caractere |

Parola **nu apare pe ecran și nu se salvează nicăieri** în cod; Supabase o păstrează criptată (bcrypt).
Ulterior, administratorul poate crea/dezactiva conturi și reseta parole direct din aplicație
(*Setări → Conturi utilizatori*), după Pasul 5.

După crearea conturilor, puteți **șterge** linia `SUPABASE_SERVICE_ROLE_KEY=` din `.env`.

> Numele coloanei „Colega” se schimbă din aplicație: *Setări → Stiliste* (ex. „Ioana”).

## Pasul 4 – Testați pe MacBook (opțional)

```bash
npm run dev
```
Deschideți http://localhost:5173 și conectați-vă cu `diana` și parola aleasă.

## Pasul 5 – Funcția de administrare a conturilor (opțional, recomandat)

Permite administratorului să gestioneze conturile din aplicație.

```bash
npx supabase login
npx supabase link --project-ref abcdefgh          # partea din URL dinaintea .supabase.co
npx supabase secrets set LOGIN_DOMAIN=agenda.laboratoruldeculoare.ro
npx supabase functions deploy admin-users
```

## Pasul 6 – Publicarea la o adresă web securizată (Vercel)

1. Intrați pe **https://vercel.com** → *Sign up* cu contul GitHub.
2. *Add New… → Project* → alegeți repository-ul **blonde-ambition** → *Import*.
3. Framework: **Vite** (detectat automat). La **Environment Variables** adăugați:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = cheia anon / publishable
   - `VITE_LOGIN_DOMAIN` = `agenda.laboratoruldeculoare.ro`
   - ⚠ **NU** adăugați cheia service_role.
4. *Deploy*. După ~1 minut primiți adresa, ex. `https://blonde-ambition.vercel.app` (HTTPS automat).
5. (Opțional) *Settings → Domains* → adăugați domeniul propriu.
6. În Supabase: *Authentication → URL Configuration* → **Site URL** = adresa de la Vercel.

Orice modificare ulterioară a codului urcată pe GitHub se publică automat. Aplicația instalată
pe telefoane se actualizează singură la următoarea deschidere.

*(Alternativ, Netlify: „Import from Git”, aceleași variabile; fișierul `netlify.toml` este deja inclus.)*

## Pasul 7 – Instalare pe iPhone / iPad

1. Deschideți adresa aplicației în **Safari** (obligatoriu Safari pe iPhone).
2. Conectați-vă cu utilizatorul și parola (prima dată e nevoie de internet).
3. Apăsați butonul **Partajare** (pătratul cu săgeată ⬆︎) → **„Adaugă pe ecranul principal”** → **Adaugă**.
4. Pe ecran apare pictograma **LC** aurie „Agenda LC”. Deschideți agenda **de acum înainte numai de pe această pictogramă** –
   ea funcționează ca o aplicație obișnuită, pe tot ecranul, și **offline**.
5. Recomandat: *Setări iPhone → Face ID și cod* activat (protejează datele clientelor dacă pierdeți telefonul).

Colega face aceiași pași pe telefonul ei, cu contul ei.

## Pasul 8 – Instalare pe MacBook

- **Safari (macOS Sonoma sau mai nou):** deschideți adresa → meniul **Fișier → Adaugă în Dock**.
- **Chrome / Edge:** pictograma de instalare ⊕ din bara de adrese → **Instalează**.

Scurtături de tastatură în calendar: `←` / `→` navigare, `T` astăzi, `N` programare nouă,
`Z` / `S` / `L` vizualizare zi / săptămână / lună.

---

## Cum funcționează offline (pe scurt)

- Fiecare telefon păstrează o **copie completă** a agendei într-o bază de date locală (IndexedDB),
  iar aplicația însăși este salvată pe dispozitiv (service worker).
- Fără internet puteți deschide agenda, consulta, **adăuga, modifica, muta, șterge și recupera** programări
  și consulta istoricul. Modificările stau într-o coadă locală și indicatorul arată
  „Offline – date salvate local”.
- Când revine internetul, coada se trimite **automat**; serverul verifică versiunea fiecărei programări.
- Dacă dumneavoastră și colega ați modificat **aceeași** programare offline, apare
  „Conflict de sincronizare”: apăsați indicatorul, vedeți cele două variante una lângă alta și alegeți.
  Varianta respinsă rămâne în istoric – nu se pierde nimic.
- Programările nu se șterg niciodată automat; ștergerea este reversibilă (*Istoric → Programări șterse*).

**Important:** nu vă deconectați (Setări → Deconectare) cât timp aveți modificări nesincronizate –
la deconectare datele locale se șterg de pe dispozitiv (pentru protecția datelor). Aplicația vă avertizează.

## Backup

1. **Baza centrală Supabase** – copia principală, sincronizată de pe ambele telefoane.
2. **Backup automat zilnic** – după prima sincronizare din fiecare zi, aplicația salvează un fișier
   `agenda-AAAA-LL-ZZ.json` în spațiul privat Supabase *Storage → backups*.
3. **Export manual** – *Setări → Export și backup*: programări sau cliente în CSV (Excel/Numbers), backup complet JSON.
4. (Opțional) planul Supabase Pro – backup zilnic al întregii baze de date, cu restaurare.

## Protecția datelor (GDPR) – ce face aplicația

- Acces numai cu cont individual; reguli Row Level Security în baza de date (fără cont activ nu se poate citi nimic).
- Parole stocate criptat (bcrypt) de Supabase Auth; sesiuni cu tokenuri care expiră și se reînnoiesc automat.
- Conexiuni criptate HTTPS; date găzduite în UE (Frankfurt).
- Înregistrarea liberă dezactivată (Pasul 1.4); conturile dezactivate pierd imediat accesul.
- La deconectare, datele se șterg de pe dispozitiv.
- Din fișa clientei: **export date** (dreptul de acces) și **ștergere definitivă** (dreptul de a fi uitat – doar administrator).
- Recomandări pentru salon: informați clientele că le păstrați numele și telefonul pentru programări
  (de ex. un afiș/notă de informare la recepție) și nu notați în observații date medicale inutile.

## Teste automate

```bash
npm test
```
Rulează 39 de teste: programări suprapuse, modificări în trecut, utilizare offline, sincronizare între
două telefoane, conflicte (ambele variante de rezolvare), recuperare după ștergere, reîncercări fără dubluri,
backup, precum și testarea schemei SQL reale (permisiuni, versiuni, istoric, GDPR) pe un motor PostgreSQL.

## Probleme frecvente

| Problemă | Soluție |
|---|---|
| „Utilizator sau parolă greșită” | Verificați literele mici/mari ale parolei; administratorul poate reseta parola din Setări. |
| „Reconectare necesară” | Sesiunea a expirat – introduceți din nou parola în bara galbenă. Datele locale rămân. |
| „Aplicația nu este configurată” | Variabilele `VITE_SUPABASE_*` lipsesc la Vercel – adăugați-le și re-publicați (*Redeploy*). |
| Nu se sincronizează deloc | Verificați în Supabase că proiectul nu este pe pauză (*Restore project*). |
| Indicator „Conflict de sincronizare” | Apăsați pe el și alegeți varianta corectă. |
