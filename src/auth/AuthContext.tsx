import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { AgendaDB } from '../data/db';
import { SyncEngine, type SyncStatus } from '../data/sync';
import type { Remote } from '../data/remote';
import { SupabaseRemote } from '../data/supabaseRemote';
import { isConfigured, supabase, usernameToEmail } from '../data/supabase';
import type { CurrentUser, Profile } from '../lib/types';

const PROFILE_KEY = 'lc-agenda-profile';

export const db = new AgendaDB();

interface AuthState {
  profile: Profile | null;
  user: CurrentUser | null;
  engine: SyncEngine | null;
  status: SyncStatus;
  ready: boolean;
  preview: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function readCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function cacheProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

/** Mod previzualizare: NUMAI în dezvoltare locală, fără Supabase configurat. */
const PREVIEW = !isConfigured && import.meta.env.DEV;

async function makeRemote(profile: Profile): Promise<Remote> {
  if (supabase) return new SupabaseRemote(supabase);
  if (import.meta.env.DEV && PREVIEW) {
    const { MemoryRemote, MemoryServer } = await import('../data/memoryRemote');
    const w = window as any;
    w.__lcServer ??= new MemoryServer();
    return new MemoryRemote(w.__lcServer, { id: profile.id, name: profile.display_name });
  }
  throw new Error('Aplicația nu este configurată (lipsește VITE_SUPABASE_URL).');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(() => readCachedProfile());
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: 'offline', lastSync: null, error: null });
  const [ready, setReady] = useState(false);
  const engineRef = useRef<SyncEngine | null>(null);

  // pornește motorul de sincronizare pentru utilizatorul curent
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      if (!profile) {
        setReady(true);
        return;
      }
      try {
        await navigator.storage?.persist?.(); // cere browserului să NU șteargă datele locale
      } catch {
        /* ignore */
      }
      const remote = await makeRemote(profile);
      if (cancelled) return;
      const e = new SyncEngine(db, remote);
      engineRef.current = e;
      const offStatus = e.onStatus(setStatus);
      // orice modificare locală (coada outbox) declanșează imediat sincronizarea
      const outboxSub = liveQuery(() => db.outbox.count()).subscribe({
        next: (n) => n > 0 && e.schedule(300),
      });
      unsub = () => {
        offStatus();
        outboxSub.unsubscribe();
      };
      setEngine(e);
      setReady(true);
      await e.start();
    })().catch((err) => {
      console.error(err);
      setReady(true);
    });
    return () => {
      cancelled = true;
      unsub?.();
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchProfile = useCallback(async (uid: string): Promise<Profile | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    return (data as Profile) ?? null;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabase || !profile) return;
    try {
      const p = await fetchProfile(profile.id);
      if (p) {
        cacheProfile(p);
        setProfile(p);
      }
    } catch {
      /* offline – rămâne profilul salvat */
    }
  }, [fetchProfile, profile]);

  // la pornire, actualizează profilul (rol, nume) când suntem online
  useEffect(() => {
    if (profile && navigator.onLine) void refreshProfile();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string) => {
    if (!username.trim() || !password) throw new Error('Completați utilizatorul și parola.');
    let p: Profile | null;
    if (PREVIEW) {
      const u = username.trim().toLowerCase();
      p = {
        id: `preview-${u}`, username: u, display_name: u === 'diana' ? 'Diana Avram' : u.charAt(0).toUpperCase() + u.slice(1),
        role: u === 'diana' ? 'admin' : 'user', stylist_id: u === 'diana' ? 'diana' : 'colega', active: true,
      };
    } else {
      if (!supabase) throw new Error('Aplicația nu este configurată. Vezi docs/INSTALARE.md.');
      if (!navigator.onLine) throw new Error('Prima conectare necesită internet.');
      const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
      if (error) {
        if (/invalid login/i.test(error.message)) throw new Error('Utilizator sau parolă greșită.');
        throw new Error(error.message);
      }
      p = await fetchProfile(data.user.id);
      if (!p || !p.active) {
        await supabase.auth.signOut();
        throw new Error('Contul nu este activ. Contactați administratorul.');
      }
    }
    const previous = readCachedProfile();
    const lastUserId = await db.getMeta<string | null>('ownerId', null);
    if ((previous && previous.id !== p.id) || (lastUserId && lastUserId !== p.id)) {
      await db.wipe(); // alt utilizator pe același dispozitiv
    }
    await db.setMeta('ownerId', p.id);
    cacheProfile(p);
    setProfile(p);
    engineRef.current?.schedule(0); // reconectare cu același cont => sincronizare imediată
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    engineRef.current?.stop();
    try {
      await supabase?.auth.signOut({ scope: 'local' });
    } catch {
      /* offline */
    }
    await db.wipe(); // datele clientelor nu rămân pe dispozitiv după deconectare (GDPR)
    cacheProfile(null);
    setProfile(null);
    setEngine(null);
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!supabase || !profile) throw new Error('Indisponibil în modul previzualizare.');
    if (next.length < 10) throw new Error('Parola nouă trebuie să aibă cel puțin 10 caractere.');
    const { data: s } = await supabase.auth.getSession();
    const email = s.session?.user.email;
    if (!email) throw new Error('Reconectați-vă mai întâi.');
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) throw new Error('Parola actuală este greșită.');
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw new Error(error.message);
  }, [profile]);

  const user = useMemo<CurrentUser | null>(
    () => (profile ? { id: profile.id, name: profile.display_name } : null),
    [profile],
  );

  const value: AuthState = {
    profile, user, engine, status, ready, preview: PREVIEW, login, logout, changePassword, refreshProfile,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth în afara AuthProvider');
  return v;
}

/** Utilizatorul curent (garantat după autentificare). */
export function useUser(): CurrentUser {
  const { user } = useAuth();
  if (!user) throw new Error('Neautentificat');
  return user;
}
