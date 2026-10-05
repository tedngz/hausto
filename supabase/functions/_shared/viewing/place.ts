// Where an availability request is for: one building, or an area (Search for
// me, the pricing rework's step 5; SPEC §11).
//
// Until Search for me every request named a complex, and code across the
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
 * The same, for the Vietnamese draft to agents: `D2` -> "Quận 2". Named
 * districts are written without their marks, which every agent reads.
 */
export function districtLabelVi(code: string): string {
  const n = code.match(/^D(\d{1,2})$/);
  return n ? `Quận ${Number(n[1])}` : districtLabel(code);
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

/** Is this listing in the place? An area by district code; a building is asked of SQL. */
export function inArea(place: InquiryPlace, districtCode: string | null): boolean {
  return place.kind === 'AREA' && !!districtCode && place.districtCodes.includes(districtCode);
}

