/**
 * The services chart, data driven from services.json so the copy can change
 * without code. Rows follow "what you would otherwise stitch together"; each
 * row that is here names services from the catalog (the services lane's
 * inventory), and a test checks every named service is in it.
 */
import data from './services.json';

export type ServiceStatus = 'here' | 'limits' | 'absent';
export interface ServiceRow { id: string; need: string; here: string; status: ServiceStatus; limit?: string; services?: string[] }
export interface CatalogRow { station: string; service: string; status: string }

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = { here: 'Here', limits: 'Here, with limits', absent: 'Not here' };

type RawRow = { id?: unknown; need?: unknown; here?: unknown; status?: unknown; limit?: unknown; services?: unknown };

/** Rows that are here first, then the honest gaps, keeping the file's order within each. */
export function serviceRows(raw: unknown = data): ServiceRow[] {
  const rows = (raw as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  const clean: ServiceRow[] = [];
  for (const r of rows as RawRow[]) {
    if (!r || typeof r.id !== 'string' || typeof r.need !== 'string' || !['here', 'limits', 'absent'].includes(r.status as string)) continue;
    const services = Array.isArray(r.services) ? r.services.filter((s): s is string => typeof s === 'string') : undefined;
    const here = services?.length ? services.join(' · ') : typeof r.here === 'string' ? r.here : '';
    if (!here) continue;
    clean.push({ id: r.id, need: r.need, here, status: r.status as ServiceStatus, ...(typeof r.limit === 'string' ? { limit: r.limit } : {}), ...(services ? { services } : {}) });
  }
  return [...clean.filter(r => r.status !== 'absent'), ...clean.filter(r => r.status === 'absent')];
}

export function serviceCatalog(raw: unknown = data): CatalogRow[] {
  const rows = (raw as { catalog?: unknown })?.catalog;
  return Array.isArray(rows) ? rows.filter((r): r is CatalogRow => !!r && typeof r.service === 'string' && typeof r.station === 'string' && typeof r.status === 'string') : [];
}

export function gapStart(rows: ServiceRow[]): number {
  const i = rows.findIndex(r => r.status === 'absent');
  return i < 0 ? rows.length : i;
}
