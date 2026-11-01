import type { Appointment, Client, Stylist } from './types';
import { formatDuration, minToTime, dayName } from './dates';

/** CSV compatibil Excel (România): separator ";" și BOM UTF-8 pentru diacritice. */
export function toCSV(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // protecție împotriva "formula injection" în Excel
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function appointmentsCSV(appts: Appointment[], clients: Map<string, Client>, stylists: Map<string, Stylist>): string {
  const header = ['Data', 'Ziua', 'Ora început', 'Ora final', 'Durata', 'Clientă', 'Telefon', 'Stilistă', 'Serviciu', 'Observații', 'Stare', 'Creată de', 'Modificată ultima dată de', 'Data modificării'];
  const sorted = [...appts].sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
  return toCSV([
    header,
    ...sorted.map((a) => {
      const c = a.client_id ? clients.get(a.client_id) : undefined;
      return [
        a.date, dayName(a.date), minToTime(a.start_min), minToTime(a.start_min + a.duration_min), formatDuration(a.duration_min),
        c?.name ?? a.client_name, c?.phone ?? a.client_phone, stylists.get(a.stylist_id)?.name ?? a.stylist_id,
        a.service, a.notes, a.deleted ? 'ștearsă' : 'activă', a.created_by_name, a.updated_by_name, a.updated_at,
      ];
    }),
  ]);
}

export function clientsCSV(clients: Client[], appts: Appointment[]): string {
  const count = new Map<string, number>();
  for (const a of appts) if (a.client_id && !a.deleted) count.set(a.client_id, (count.get(a.client_id) ?? 0) + 1);
  return toCSV([
    ['Nume', 'Telefon', 'Observații', 'Nr. programări'],
    ...[...clients].filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ro')).map((c) => [c.name, c.phone, c.notes, count.get(c.id) ?? 0]),
  ]);
}

export function download(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
