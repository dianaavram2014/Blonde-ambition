export interface ServiceDef {
  id: string;
  label: string;
  color: string; // fundal pastel
  ink: string; // accent
}

export const SERVICES: ServiceDef[] = [
  { id: 'vopsit', label: 'Vopsit', color: '#F6DCE3', ink: '#B5637A' },
  { id: 'balayage', label: 'Balayage', color: '#F9E3CF', ink: '#B87A3F' },
  { id: 'suvite', label: 'Șuvițe', color: '#F6EFC8', ink: '#9C8A2E' },
  { id: 'tuns', label: 'Tuns', color: '#DDEFE2', ink: '#4F8A62' },
  { id: 'coafat', label: 'Coafat', color: '#E6E0F4', ink: '#7461A8' },
  { id: 'tratament', label: 'Tratament', color: '#DCEBF4', ink: '#4A7FA0' },
];

export const OTHER_SERVICE: ServiceDef = { id: 'altul', label: 'Alt serviciu', color: '#EFE8DD', ink: '#8A7457' };

export const DURATIONS = [30, 45, 60, 90, 120, 180];

/** Culoarea blocului se alege după primul serviciu recunoscut. */
export function serviceStyle(service: string): ServiceDef {
  const first = service.split(',')[0]?.trim().toLowerCase() ?? '';
  const norm = normalize(first);
  return SERVICES.find((s) => normalize(s.label) === norm) ?? OTHER_SERVICE;
}

export function splitServices(service: string): string[] {
  return service.split(',').map((s) => s.trim()).filter(Boolean);
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizePhone(p: string): string {
  let d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('+40')) d = '0' + d.slice(3);
  else if (d.startsWith('0040')) d = '0' + d.slice(4);
  return d.replace(/\+/g, '');
}
