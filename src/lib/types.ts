export type Entity = 'appointments' | 'clients';

export interface Meta {
  version: number; // versiunea de pe server (0 = încă nesincronizată)
  created_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
}

export interface AppointmentData {
  client_id: string | null;
  client_name: string;
  client_phone: string;
  stylist_id: string;
  date: string; // YYYY-MM-DD (dată locală)
  start_min: number; // minute de la miezul nopții
  duration_min: number;
  service: string;
  notes: string;
  deleted: boolean;
}

export interface ClientData {
  name: string;
  phone: string;
  notes: string;
  deleted: boolean;
}

export type Appointment = AppointmentData & Meta & { id: string };
export type Client = ClientData & Meta & { id: string };

export interface Stylist {
  id: string;
  name: string;
  color: string;
  sort: number;
  active: boolean;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  stylist_id: string | null;
  active: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
}

export interface OutboxItem {
  key: string; // `${entity}:${id}`
  entity: Entity;
  id: string;
  baseVersion: number;
  mutationId: string;
  data: AppointmentData | ClientData;
  seq: number;
  createdAt: string;
}

export interface Conflict {
  key: string;
  entity: Entity;
  id: string;
  local: AppointmentData | ClientData;
  localBaseVersion: number;
  localBy: string | null;
  server: (Appointment | Client) | null;
  detectedAt: string;
}

export type HistoryAction = 'create' | 'update' | 'delete' | 'restore' | 'erase' | 'rejected';

export interface HistoryEntry {
  id: string; // 's:<id server>' sau 'l:<mutationId>'
  entity: Entity;
  entity_id: string;
  action: HistoryAction;
  version: number | null;
  snapshot: Partial<Appointment & Client>;
  mutation_id: string | null;
  changed_by_name: string | null;
  changed_at: string;
  pending: 0 | 1;
}

export const APPOINTMENT_FIELDS: (keyof AppointmentData)[] = [
  'client_id', 'client_name', 'client_phone', 'stylist_id', 'date',
  'start_min', 'duration_min', 'service', 'notes', 'deleted',
];
export const CLIENT_FIELDS: (keyof ClientData)[] = ['name', 'phone', 'notes', 'deleted'];

export function pickData(entity: Entity, row: Record<string, any>): AppointmentData | ClientData {
  const fields = entity === 'appointments' ? APPOINTMENT_FIELDS : CLIENT_FIELDS;
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = row[f];
  return out as unknown as AppointmentData | ClientData;
}

export function sameData(entity: Entity, a: Record<string, any>, b: Record<string, any>): boolean {
  const fields = entity === 'appointments' ? APPOINTMENT_FIELDS : CLIENT_FIELDS;
  return fields.every((f) => (a[f] ?? null) === (b[f] ?? null));
}
