// Utilitare pentru date – totul în limba română, săptămâna începe luni.
// Datele sunt păstrate ca șiruri "YYYY-MM-DD" (dată locală) pentru a evita
// problemele de fus orar.

export const ZILE = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
export const ZILE_SCURT = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
export const LUNI = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];
export const LUNI_SCURT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // ora 12 => fără surprize la schimbarea orei
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso: string, n: number): string {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function addYears(iso: string, n: number): string {
  return addMonths(iso, n * 12);
}

/** Ziua de luni a săptămânii care conține data. */
export function startOfWeek(iso: string): string {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = luni
  return addDays(iso, -dow);
}

export function weekDays(iso: string): string[] {
  const s = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** 42 de zile (6 săptămâni) pentru grila lunară. */
export function monthGrid(iso: string): string[] {
  const d = fromISO(iso);
  const first = toISO(new Date(d.getFullYear(), d.getMonth(), 1, 12));
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function dayName(iso: string): string {
  return ZILE[fromISO(iso).getDay()];
}

/** "Luni, 2 Noiembrie 2026" */
export function formatLong(iso: string): string {
  const d = fromISO(iso);
  return `${ZILE[d.getDay()]}, ${d.getDate()} ${LUNI[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2 noi 2026" */
export function formatShort(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()} ${LUNI_SCURT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatMonthYear(iso: string): string {
  const d = fromISO(iso);
  return `${LUNI[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatWeekRange(iso: string): string {
  const days = weekDays(iso);
  const a = fromISO(days[0]);
  const b = fromISO(days[6]);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${LUNI[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()} ${LUNI_SCURT[a.getMonth()]} – ${b.getDate()} ${LUNI_SCURT[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${formatShort(days[0])} – ${formatShort(days[6])}`;
}

export function minToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  if (!m) return h === 1 ? '1 oră' : `${h} ore`;
  return `${h} h ${m} min`;
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function formatDateTime(isoTs: string | null | undefined): string {
  if (!isoTs) return '';
  const d = new Date(isoTs);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()} ${LUNI_SCURT[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromISO(s);
  return toISO(d) === s;
}
