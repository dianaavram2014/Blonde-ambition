import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../auth/AuthContext';
import { DEFAULT_STYLISTS } from './db';
import type { Appointment, Client, Stylist } from '../lib/types';
import { nowMinutes, todayISO } from '../lib/dates';

export function useStylists(): Stylist[] {
  const list = useLiveQuery(() => db.stylists.orderBy('sort').toArray(), []);
  const active = (list && list.length ? list : DEFAULT_STYLISTS).filter((s) => s.active);
  return active;
}

export function useAppointmentsRange(from: string, to: string, includeDeleted = false): Appointment[] {
  return (
    useLiveQuery(
      async () => {
        const rows = await db.appointments.where('date').between(from, to, true, true).toArray();
        return includeDeleted ? rows : rows.filter((a) => !a.deleted);
      },
      [from, to, includeDeleted],
    ) ?? []
  );
}

export function useClientsMap(): Map<string, Client> {
  const list = useLiveQuery(() => db.clients.toArray(), []) ?? [];
  const map = new Map<string, Client>();
  for (const c of list) map.set(c.id, c);
  return map;
}

export function usePendingKeys(): Set<string> {
  const keys = useLiveQuery(() => db.outbox.toCollection().primaryKeys(), []) ?? [];
  return new Set(keys as string[]);
}

export function useCounts() {
  return useLiveQuery(
    async () => ({ pending: await db.outbox.count(), conflicts: await db.conflicts.count() }),
    [],
  ) ?? { pending: 0, conflicts: 0 };
}

/** Data și ora reale, actualizate automat (inclusiv trecerea la ziua următoare). */
export function useNow() {
  const [now, setNow] = useState(() => ({ today: todayISO(), minutes: nowMinutes() }));
  useEffect(() => {
    const t = setInterval(() => setNow({ today: todayISO(), minutes: nowMinutes() }), 30_000);
    const vis = () => setNow({ today: todayISO(), minutes: nowMinutes() });
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return now;
}

/** Numele afișat al clientei: datele actuale din fișa clientei au prioritate. */
export function clientLabel(a: Appointment, clients: Map<string, Client>) {
  const c = a.client_id ? clients.get(a.client_id) : undefined;
  return { name: c?.name || a.client_name, phone: c?.phone ?? a.client_phone };
}
