import { createContext, useContext } from 'react';

export type Page = 'calendar' | 'search' | 'history' | 'settings';
export type CalView = 'day' | 'week' | 'month';

export interface NewPrefill {
  date?: string;
  start_min?: number;
  stylist_id?: string | null;
  client_id?: string | null;
}

export interface NavApi {
  page: Page;
  setPage: (p: Page) => void;
  calDate: string;
  setCalDate: (d: string) => void;
  calView: CalView;
  setCalView: (v: CalView) => void;
  goToday: () => void;
  openNew: (prefill?: NewPrefill) => void;
  openEdit: (id: string) => void;
  openClient: (id: string) => void;
  showConflicts: () => void;
}

export const NavCtx = createContext<NavApi | null>(null);

export function useNav() {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav în afara NavCtx');
  return v;
}
