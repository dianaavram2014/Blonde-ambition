import type { Appointment, AppointmentData, Client, ClientData, Entity, Stylist } from '../lib/types';

export interface PushRequest {
  id: string;
  baseVersion: number;
  mutationId: string;
  data: AppointmentData | ClientData;
}

export type PushResult =
  | { status: 'ok'; row: Appointment | Client }
  | { status: 'conflict'; row: Appointment | Client }
  | { status: 'missing' };

export interface RemoteHistoryRow {
  id: number;
  entity: Entity;
  entity_id: string;
  action: string;
  version: number | null;
  snapshot: Record<string, unknown>;
  mutation_id: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

/** Interfața către baza de date centrală (implementată de Supabase). */
export interface Remote {
  pull(entity: Entity, since: string | null): Promise<(Appointment | Client)[]>;
  push(entity: Entity, req: PushRequest): Promise<PushResult>;
  pullHistory(afterId: number): Promise<RemoteHistoryRow[]>;
  pullStylists(): Promise<Stylist[]>;
  /** Abonare la modificări în timp real. Întoarce funcția de dezabonare. */
  subscribe(onChange: () => void): () => void;
  uploadBackup(name: string, json: string): Promise<void>;
  /** Verifică dacă există o sesiune validă; false => trebuie reautentificare. */
  hasSession(): Promise<boolean>;
}

export class NetworkError extends Error {
  constructor(msg = 'Fără conexiune') {
    super(msg);
    this.name = 'NetworkError';
  }
}

export class AuthError extends Error {
  constructor(msg = 'Sesiune expirată') {
    super(msg);
    this.name = 'AuthError';
  }
}
