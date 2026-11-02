import { FACETS, type FacetId } from '../../data';
import { VIEW_MODES, type ViewMode } from '../../shell/contracts';
import { SIRALAR, TARIH_TURLERI, ZAMAN_ALANLARI } from './query';

// URL: wouter hash konumu "#/alimlar[/<id>][?mod=…&ara=…&room=…]". wouter'ın iç içe rota deseni "/alimlar"dan sonra
// "/" ya da son bekler; bu yüzden seçim yokken sorgu "#/alimlar/?…" biçiminde yazılır. Saf; React yok.

export const KONUM = '/alimlar';

export interface AlimlarUrlState {
  /** Seçili kayıt (ayrıntı açık). */
  id: string | null;
  mode: ViewMode | null;
  search: string;
  /** SIRALAR anahtarı. */
  sort: string | null;
  /** FacetId → seçili değerler (aralık boyutlarında "baslangic=…" gibi girdiler). */
  facets: Record<string, readonly string[]>;
  /** Filtre tarih türü (DateField); varsayılansa null. */
  dateType: string | null;
  /** Zaman çizelgesi tarih alanı; varsayılansa null. */
  timelineField: string | null;
}

const URL_ANAHTAR = { mode: 'mod', search: 'ara', sort: 'sira', dateType: 'tarih', timelineField: 'zaman' } as const;
const FACET_IDS: readonly FacetId[] = FACETS.map(facet => facet.id);

const isViewMode = (value: string | null): value is ViewMode => value !== null && (VIEW_MODES as readonly string[]).includes(value);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Durumu hash'e çevirir: "#/alimlar", "#/alimlar/<id>", "#/alimlar/?mod=…", "#/alimlar/<id>?mod=…". */
export function buildAlimlarHash(state: AlimlarUrlState, location = KONUM): string {
  const params = new URLSearchParams();
  if (state.mode) params.set(URL_ANAHTAR.mode, state.mode);
  if (state.search) params.set(URL_ANAHTAR.search, state.search);
  if (state.sort) params.set(URL_ANAHTAR.sort, state.sort);
  for (const id of FACET_IDS) {
    const values = state.facets[id];
    if (values && values.length) params.set(id, values.map(value => encodeURIComponent(value)).join(','));
  }
  if (state.dateType) params.set(URL_ANAHTAR.dateType, state.dateType);
  if (state.timelineField) params.set(URL_ANAHTAR.timelineField, state.timelineField);
  const query = params.toString();
  const idPart = state.id ? `/${encodeURIComponent(state.id)}` : '';
  if (!query) return `#${location}${idPart}`;
  return `#${location}${idPart || '/'}?${query}`;
}

/** Hash'i okur; bu sayfanın yolu değilse null. Geçersiz mod/sıra/tarih değerleri yok sayılır. */
export function parseAlimlarHash(hash: string, location = KONUM): AlimlarUrlState | null {
  const raw = hash.replace(/^#/, '');
  const mark = raw.indexOf('?');
  const path = mark >= 0 ? raw.slice(0, mark) : raw;
  const query = mark >= 0 ? raw.slice(mark + 1) : '';
  if (path !== location && !path.startsWith(`${location}/`)) return null;
  const rest = path.slice(location.length).replace(/^\/+/, '').replace(/\/+$/, '');
  const id = rest ? decode(rest) : null;
  const params = new URLSearchParams(query);
  const mode = params.get(URL_ANAHTAR.mode);
  const sort = params.get(URL_ANAHTAR.sort);
  const dateType = params.get(URL_ANAHTAR.dateType);
  const timelineField = params.get(URL_ANAHTAR.timelineField);
  const facets: Record<string, readonly string[]> = {};
  for (const facetId of FACET_IDS) {
    const value = params.get(facetId);
    if (!value) continue;
    const values = value.split(',').map(decode).filter((item): item is string => item !== null && item !== '');
    if (values.length) facets[facetId] = values;
  }
  return {
    id: id || null,
    mode: isViewMode(mode) ? mode : null,
    search: params.get(URL_ANAHTAR.search) ?? '',
    sort: sort && SIRALAR.some(option => option.key === sort) ? sort : null,
    facets,
    dateType: dateType && TARIH_TURLERI.some(option => option.value === dateType) ? dateType : null,
    timelineField: timelineField && ZAMAN_ALANLARI.some(option => option.value === timelineField) ? timelineField : null,
  };
}

export function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}
