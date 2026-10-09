// Where an availability request is for: one building, or an area (Search for
// me, the pricing rework's step 5; SPEC §11).
//
// Until Priority search every request named a complex, and code across the
// concierge flow read its name, district and city straight from `complexes`.
// An area request has no complex: it has district codes and a label. This is
// the one place that knows the difference, so the rest asks it rather than
// each reading `complexes` and falling back differently.

// deno-lint-ignore no-explicit-any
type Supa = any;

export type PlaceKind = 'BUILDING' | 'AREA';

export interface InquiryPlace {
  kind: PlaceKind;
  /** "Empire City", or "District 2 and Binh Thanh". */
  name: string;
  district: string | null;
  city: string;
  complexId: string | null;
  /** The area's district codes; empty for a building. */
  districtCodes: string[];
  slug: string | null;
}

/** The districts an area request may name, at most. Wider is a different search. */
export const MAX_AREA_DISTRICTS = 4;

/** A promise per kind: a building's agents are few and known; an area's are not. */
export const REPLY_WITHIN_HOURS: Record<PlaceKind, number> = { BUILDING: 24, AREA: 48 };

/**
 * A search showing fewer places than this is thin, and Browse and the chat
 * offer Priority search under it - prefilled from that search.
 */
export const THIN_SEARCH = 3;

const DISTRICT_CODE = /^[A-Z][A-Z0-9_]{1,19}$/;

export function isDistrictCode(code: unknown): code is string {
  return typeof code === 'string' && DISTRICT_CODE.test(code);
}

/** `D2` -> "District 2", `BINH_THANH` -> "Binh Thanh". */
export function districtLabel(code: string): string {
  const n = code.match(/^D(\d{1,2})$/);
  if (n) return `District ${Number(n[1])}`;
  return code.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

/**
 * `districtLabel` backwards, for the renter app's district names: "District 2"
 * -> `D2`, "Binh Thanh" -> `BINH_THANH`. The codes are vn_district_code's.
 */
export function districtCodeOf(label: string): string | null {
  const n = label.trim().match(/^District (\d{1,2})$/i);
  const code = n ? `D${Number(n[1])}` : label.trim().toUpperCase().replace(/\s+/g, '_');
  return isDistrictCode(code) ? code : null;
}

/** Ho Chi Minh City's named districts, as an agent writes them. */
const NAMED_VI: Record<string, string> = {
  BINH_THANH: 'Bình Thạnh', TAN_BINH: 'Tân Bình', TAN_PHU: 'Tân Phú', PHU_NHUAN: 'Phú Nhuận',
  GO_VAP: 'Gò Vấp', THU_DUC: 'Thủ Đức', BINH_TAN: 'Bình Tân', NHA_BE: 'Nhà Bè',
  BINH_CHANH: 'Bình Chánh', HOC_MON: 'Hóc Môn', CU_CHI: 'Củ Chi', CAN_GIO: 'Cần Giờ',
};

/**
 * The same, for the Vietnamese draft to agents: `D2` -> "Quận 2",
 * `BINH_THANH` -> "Bình Thạnh". A code with no spelling here falls back to the
 * English, unmarked, which an agent still reads.
 */
export function districtLabelVi(code: string): string {
  const n = code.match(/^D(\d{1,2})$/);
  return n ? `Quận ${Number(n[1])}` : NAMED_VI[code] ?? districtLabel(code);
}

export function areaLabelVi(codes: string[]): string {
  const labels = [...new Set(codes)].map(districtLabelVi);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} và ${labels[labels.length - 1]}`;
}

/** "District 2", "District 2 and Binh Thanh", "District 2, Binh Thanh and District 7". */
export function areaLabel(codes: string[]): string {
  const labels = [...new Set(codes)].map(districtLabel);
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * What a Priority search opens filled in with, from a link: the renter app's
 * district names, as `SearchPrefill` takes them.
 */
export interface PrioritySearchBrief {
  districtCodes: string[];
  bedrooms: number | null;
  budgetMaxVnd: number | null;
}

/**
 * The hub, with Priority search open and filled in - for a WhatsApp message
 * whose places all fell through (deliver.ts). `/hub?priority=D7,BINH_THANH&beds=2&max=17000000`.
 * Read back by `prioritySearchFromQuery`, so the two cannot disagree.
 */
export function prioritySearchPath(b: PrioritySearchBrief): string {
  const q = new URLSearchParams();
  q.set('priority', [...new Set(b.districtCodes.filter(isDistrictCode))].slice(0, MAX_AREA_DISTRICTS).join(','));
  if (b.bedrooms && b.bedrooms > 0) q.set('beds', String(Math.round(b.bedrooms)));
  if (b.budgetMaxVnd && b.budgetMaxVnd > 0) q.set('max', String(Math.round(b.budgetMaxVnd)));
  // URLSearchParams writes the comma as %2C; a link a renter can read is
  // worth keeping it plain, and a comma is legal in a query.
  return `/hub?${q.toString().replace(/%2C/g, ',')}`;
}

/** The brief a `prioritySearchPath` link carries, or null when it carries none. */
export function prioritySearchFromQuery(params: URLSearchParams): {
  districts: string[]; bedrooms: number | null; budgetMaxVnd: number | null;
} | null {
  const raw = params.get('priority');
  if (raw == null) return null;
  const codes = raw.split(',').map(s => s.trim()).filter(isDistrictCode).slice(0, MAX_AREA_DISTRICTS);
  const beds = Number(params.get('beds'));
  const max = Number(params.get('max'));
  return {
    districts: codes.map(districtLabel),
    bedrooms: Number.isInteger(beds) && beds > 0 ? beds : null,
    budgetMaxVnd: Number.isFinite(max) && max > 0 ? Math.round(max) : null,
  };
}

/** The city an area is in, from its codes. The viewing flow is Ho Chi Minh City's. */
export function areaCity(_codes: string[]): string {
  return 'ho_chi_minh';
}

/** The request's place, from its row. Null for a building that no longer exists. */
export async function placeOf(
  db: Supa,
  row: { complex_id: string | null; area_district_codes?: string[] | null; area_label?: string | null },
): Promise<InquiryPlace | null> {
  if (!row.complex_id) {
    const codes = (row.area_district_codes ?? []).filter(isDistrictCode);
    if (codes.length === 0) return null;
    return {
      kind: 'AREA', name: row.area_label || areaLabel(codes), district: null, city: areaCity(codes),
      complexId: null, districtCodes: codes, slug: null,
    };
  }
  const { data: c } = await db.from('complexes').select('id, name, district, city, slug').eq('id', row.complex_id).maybeSingle();
  if (!c) return null;
  return {
    kind: 'BUILDING', name: String(c.name), district: (c.district as string | null) ?? null,
    city: String(c.city ?? 'ho_chi_minh'), complexId: String(c.id), districtCodes: [], slug: (c.slug as string | null) ?? null,
  };
}

