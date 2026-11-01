import { describe, it, expect } from 'vitest';
import {
  addDays, addMonths, formatLong, monthGrid, startOfWeek, weekDays, minToTime, formatDuration, formatWeekRange, isValidISODate,
} from '../src/lib/dates';
import { findOverlaps, layoutLanes } from '../src/lib/overlap';
import { normalizePhone, serviceStyle } from '../src/lib/services';
import { toCSV } from '../src/lib/csv';

describe('calendar în limba română', () => {
  it('afișează ziua, data, luna și anul', () => {
    expect(formatLong('2026-11-02')).toBe('Luni, 2 Noiembrie 2026');
    expect(formatLong('2026-11-01')).toBe('Duminică, 1 Noiembrie 2026');
    expect(formatLong('2024-02-29')).toBe('Joi, 29 Februarie 2024');
  });
  it('săptămâna începe luni și se termină duminică', () => {
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26');
    const w = weekDays('2026-11-04');
    expect(w[0]).toBe('2026-11-02');
    expect(w[6]).toBe('2026-11-08');
    expect(formatWeekRange('2026-11-04')).toBe('2 – 8 Noiembrie 2026');
  });
  it('navigare între zile, luni și ani (inclusiv ani bisecți)', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-29', -12)).toBe('2025-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // schimbarea orei de vară
  });
  it('grila lunară are 6 săptămâni începând cu luni', () => {
    const g = monthGrid('2026-11-15');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26');
    expect(g).toContain('2026-11-30');
  });
  it('ore și durate', () => {
    expect(minToTime(8 * 60)).toBe('08:00');
    expect(minToTime(20 * 60 - 15)).toBe('19:45');
    expect(formatDuration(90)).toBe('1 h 30 min');
    expect(formatDuration(180)).toBe('3 ore');
    expect(formatDuration(45)).toBe('45 min');
    expect(isValidISODate('2026-02-30')).toBe(false);
  });
});

describe('suprapuneri și afișare', () => {
  const a = (id: string, start: number, dur: number, stylist = 'diana') => ({ id, start_min: start, duration_min: dur, stylist_id: stylist, date: '2026-11-02', deleted: false });
  it('detectează suprapuneri parțiale și totale', () => {
    const list = [a('1', 600, 60), a('2', 720, 30)];
    expect(findOverlaps(a('x', 630, 15), list).map((x) => x.id)).toEqual(['1']);
    expect(findOverlaps(a('x', 570, 200), list).map((x) => x.id)).toEqual(['1', '2']);
    expect(findOverlaps(a('x', 660, 60), list)).toHaveLength(0);
  });
  it('așază programările suprapuse una lângă alta', () => {
    const l = layoutLanes([a('1', 600, 60), a('2', 630, 60), a('3', 670, 30)]);
    expect(l.get('1')).toEqual({ lane: 0, lanes: 2 });
    expect(l.get('2')).toEqual({ lane: 1, lanes: 2 });
    expect(l.get('3')).toEqual({ lane: 0, lanes: 2 });
    const single = layoutLanes([a('9', 900, 30)]);
    expect(single.get('9')).toEqual({ lane: 0, lanes: 1 });
  });
});

describe('utilitare', () => {
  it('normalizează numerele de telefon românești', () => {
    expect(normalizePhone('+40 722-111-222')).toBe('0722111222');
    expect(normalizePhone('0040722111222')).toBe('0722111222');
    expect(normalizePhone('0722 111 222')).toBe('0722111222');
  });
  it('culoarea după serviciu', () => {
    expect(serviceStyle('Balayage, Tuns').id).toBe('balayage');
    expect(serviceStyle('suvite').id).toBe('suvite');
    expect(serviceStyle('Keratină').id).toBe('altul');
  });
  it('CSV pentru Excel: BOM, ";" și protecție la formule', () => {
    const csv = toCSV([['Nume', 'Obs'], ['Ana; Maria', '=HYPERLINK("x")'], ['Ioana', '-5']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Ana; Maria"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('Ioana;-5');
  });
});
