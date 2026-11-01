# Laboratorul de Culoare – Smart Agenda

Agenda electronică a salonului **Laboratorul de Culoare by Diana Avram**: aplicație web progresivă (PWA)
care se instalează pe iPhone, iPad, MacBook și orice dispozitiv cu browser, funcționează **complet offline**
și se sincronizează automat între telefoanele Dianei și ale colegei.

➡ **Instalare și publicare pas cu pas: [docs/INSTALARE.md](docs/INSTALARE.md)**

## Arhitectură

```
 iPhone Diana                      iPhone Colega
┌──────────────────────┐          ┌──────────────────────┐
│ React + TypeScript   │          │ React + TypeScript   │
│ IndexedDB (Dexie):   │          │ IndexedDB (Dexie):   │
│  copie completă +    │          │  copie completă +    │
│  coadă modificări    │          │  coadă modificări    │
│ Service worker (PWA) │          │ Service worker (PWA) │
└─────────┬────────────┘          └────────────┬─────────┘
          │  HTTPS: push (cu versiune) / pull   │
          │  + Realtime (WebSocket)             │
          ▼                                     ▼
   ┌──────────────────────────────────────────────────┐
   │ Supabase (PostgreSQL, UE – Frankfurt)            │
   │  appointments · clients · stylists · profiles    │
   │  change_log (istoric automat)                    │
   │  push_appointment / push_client: versiuni,       │
   │    detectare conflicte, autor, istoric           │
   │  Row Level Security · Auth (bcrypt) · Storage    │
   └──────────────────────────────────────────────────┘
```

- **Offline-first:** orice operație se scrie întâi local (IndexedDB) și intră într-o coadă (`outbox`).
  Motorul de sincronizare (`src/data/sync.ts`) trimite coada cu *versiunea de bază*; serverul acceptă
  doar dacă versiunea coincide, altfel răspunde „conflict” și ambele variante se păstrează până la decizie.
- **Idempotent:** fiecare modificare are un ID unic → o reîncercare după un răspuns pierdut nu creează dubluri.
- **Fără pierderi:** ștergerile sunt „soft” (recuperabile); fiecare versiune intră în `change_log`.
- **Timp real:** când colega salvează ceva, telefonul Dianei primește notificare prin WebSocket și se actualizează.

## Structura proiectului

| Cale | Conținut |
|---|---|
| `src/data/sync.ts` | motorul de sincronizare (push/pull, conflicte, istoric, backup zilnic) |
| `src/data/repo.ts` | operații locale: salvare, mutare, ștergere, recuperare, revenire la versiune, cliente |
| `src/data/db.ts` | baza locală IndexedDB |
| `src/data/supabaseRemote.ts` | conexiunea la Supabase |
| `src/pages/*`, `src/components/*` | interfața: calendar zi/săptămână/lună, programare, cliente, istoric, setări |
| `supabase/migrations/*.sql` | schema bazei de date centrale, funcții, securitate RLS |
| `supabase/functions/admin-users` | administrarea conturilor (numai administrator) |
| `scripts/create-user.mjs` | crearea sigură a conturilor (parola tastată, nu salvată în cod) |
| `tests/` | teste automate |

## Comenzi

```bash
npm install          # instalare dependențe
npm run dev          # rulare locală (fără Supabase configurat => mod previzualizare, doar pentru dezvoltare)
npm test             # 39 de teste automate
npm run build        # versiunea de producție (dosarul dist/)
npm run create-user  # creare cont (Diana / colega)
```

## Verificarea cerințelor

| # | Cerință | Rezolvare | Verificat prin |
|---|---|---|---|
| 1 | Conturi individuale Diana (admin) + colegă | Supabase Auth + `profiles` (rol admin/user); `npm run create-user`; administrare conturi în Setări | test SQL „refuză accesul…” |
| 1 | Ambele pot adăuga/modifica/șterge orice, inclusiv trecut | fără restricții de dată; RLS permite personalului activ | teste „modificări în trecut” |
| 1 | Cine a creat / modificat ultima dată | `created_by_name`, `updated_by_name` setate de server; afișate pe bloc și în fereastră | test SQL „autorul” |
| 2 | Luni–duminică, 08:00–20:00, intervale de 15 min | grilă cu linii la 15 min (se extinde automat dacă există programări în afara orelor) | test date + verificare vizuală |
| 2 | Durate 30/45/60/90/120/180 + personalizată | butoane rapide + „Altă durată” (minute sau ora de final) | test e2e |
| 2 | Zi (coloane Diana / Colega), Săptămână, Lună; nume în română | `CalendarPage`, `TimeGrid` | teste date românești |
| 2 | Navigare zile/săpt./luni/ani, buton „Astăzi”, dată reală | ‹ › « » 📅 (orice dată), Astăzi, trecere automată la ziua nouă | e2e |
| 3 | Click pe interval liber → formular complet, „Salvează programarea” | `AppointmentDialog`, precompletare dată/oră/stilistă | e2e |
| 3 | Avertizare la suprapunere | avertizare imediată + confirmare la salvare/mutare; suprapunerile apărute offline sunt marcate ⚠ | teste suprapuneri |
| 4 | Modificare orice câmp, orice dată | formular complet de editare | teste |
| 4 | Mutare prin drag-and-drop | mouse: trageți; telefon: țineți apăsat apoi trageți; altă oră / stilistă / zi (săptămânal) | e2e |
| 4 | Ștergere cu confirmare; recuperare; istoric | confirmare + „Anulează”; Istoric → Programări șterse; istoric per programare cu „Revino” | teste recuperare/revenire |
| 5 | Offline real: deschidere, consultare, adăugare, modificare, ștergere, istoric | IndexedDB + coadă + service worker | teste offline + e2e offline (Playwright) |
| 5 | Sincronizare automată la revenirea internetului | evenimente online/vizibilitate, realtime, la 60 s | teste |
| 5 | Conflicte detectate, alegere fără pierdere | versiuni + ecran de comparare; varianta respinsă în istoric | teste conflicte + e2e |
| 5 | Indicator Online / Offline / Sincronizare / Conflict | pastila din antet | e2e |
| 6 | Căutare după nume/telefon; fișa clientei cu istoric | `SearchPage`, `ClientDialog`; telefonul se poate schimba fără pierderea istoricului | test „modificarea clientei” |
| 7 | Design crem/negru/champagne, pasteluri, butoane principale, pictogramă | `styles.css`, pictograme `public/` | capturi de ecran |
| 8 | Parole criptate, sesiuni securizate, RLS, export CSV, backup cloud, GDPR, schimbare parolă | Supabase Auth, RLS, `push_*` security definer, Storage privat, export/ștergere date clientă | teste SQL + backup |
| 9 | Fără parole prestabilite în cod | conturile se creează interactiv; înregistrarea publică dezactivată | – |

## Limitări cunoscute (v1)

- Prima autentificare pe un dispozitiv necesită internet (ulterior, offline).
- Conflictul se rezolvă alegând **o variantă întreagă** (a mea / a serverului); varianta respinsă rămâne în istoric și poate fi restaurată cu „Revino”.
- Administrarea conturilor și ștergerea definitivă (GDPR) necesită internet.
- Exportul este CSV (se deschide direct în Excel/Numbers), nu .xlsx nativ.
