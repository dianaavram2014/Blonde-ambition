import type { AppointmentData } from './types';

type Slot = Pick<AppointmentData, 'stylist_id' | 'date' | 'start_min' | 'duration_min' | 'deleted'> & { id: string };

export function overlaps(a: Slot, b: Slot): boolean {
  if (a.id === b.id) return false;
  if (a.deleted || b.deleted) return false;
  if (a.stylist_id !== b.stylist_id || a.date !== b.date) return false;
  return a.start_min < b.start_min + b.duration_min && b.start_min < a.start_min + a.duration_min;
}

/** Returnează programările existente care se suprapun cu `candidate`. */
export function findOverlaps<T extends Slot>(candidate: Slot, existing: T[]): T[] {
  return existing.filter((e) => overlaps(candidate, e));
}

/**
 * Așezare pe "benzi" pentru programările care se suprapun în aceeași coloană
 * (de ex. sincronizate offline de pe două telefoane), ca să fie toate vizibile.
 */
export function layoutLanes<T extends { id: string; start_min: number; duration_min: number }>(
  items: T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start_min - b.start_min || b.duration_min - a.duration_min);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: T[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length;
    for (const it of cluster) result.get(it.id)!.lanes = lanes;
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (it.start_min >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start_min);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = it.start_min + it.duration_min;
    result.set(it.id, { lane, lanes: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.start_min + it.duration_min);
  }
  if (cluster.length) flush();
  return result;
}
