// How a message to an agent names the unit it is about.
//
// Never by its title. Our titles are written in English for renters ("Chic
// Urban Retreat in Lavida Plus with Modern Elegance"), and an agent with forty
// chats open does not recognise their own ad from that - one asked "Căn chic
// urban là gì z ạ" on 2026-10-08. They know a unit by where it is: the
// building, else the street, else the ward and district. And by the ad itself,
// so the link goes with every message, not only the first.
//
// Parsed from the listing's own text rather than matched against `complexes`,
// which knows two dozen buildings; the crawler's titles and locations name many
// more. When nothing specific can be read, the district is still better than
// an English title, and the link carries the rest.

import { districtCodeOf, districtLabel, districtLabelVi } from '../viewing/place.ts';

export interface AgentUnit {
  /** "căn 2PN ở Lavida Plus, Quận 7" - reads after "xem", "về", "lịch xem". */
  name: string;
  /** The ad the agent posted. Null only when we have none. */
  url: string | null;
}

export interface UnitListing {
  title: string | null;
  location: string | null;
  districtCode: string | null;
  bedrooms: number | null;
  url: string | null;
}

export function agentUnit(l: UnitListing): AgentUnit {
  const kind = l.bedrooms != null && l.bedrooms >= 1
    ? `căn ${l.bedrooms}PN`
    : l.bedrooms === 0 && /studio/i.test(l.title ?? '') ? 'căn studio' : 'căn hộ';
  const place = placeVi(l);
  return { name: place ? `${kind} ở ${place}` : kind, url: l.url || null };
}

/** The line under the sentence naming the unit. Empty when there is no link. */
export function unitLink(unit: AgentUnit): string[] {
  return unit.url ? [`Tin đăng: ${unit.url}`] : [];
}

// ── Reading a location ──────────────────────────────────────────────────────
// The crawler hands these over in several shapes, all comma-separated:
//   "Street Nguyen Van Linh, Ward Tan Phong, District 7, Ho Chi Minh City"
//   "Vinhomes Central Park, Thanh My Tay Ward, Binh Thanh District, Ho Chi Minh City"
//   "35 Le Van Luong, Ward Nhan Chinh, District Thanh Xuan, Ha Noi"
//   "District 7"

const CITY = /^(ho chi minh|hồ chí minh|tp\.? ?hcm|hcmc?|tp\.? hồ chí minh|saigon|sài gòn|ha noi|hanoi|hà nội|da nang|đà nẵng)( city)?$/i;

/**
 * Words that make a bare segment a building rather than a street. A street
 * with no "Street" marker ("Truong Luu", "Hoang Minh Giam") reads like a name
 * too, and calling a street a building would send the agent looking for the
 * wrong thing - so a segment has to say it is one.
 */
const BUILDING_WORD = /\b(city|gardens?|park|residences?|towers?|plaza|island|boulevard|riverside|royal|pearl|vinhomes|masteri|cent(?:er|re)|homes?|apartments?|sky|sol|gateway|square|court|building|mansion|villas?|place|heights|pointe?|marina|bay|views?|hills?|star|golden|diamond|palace|sunrise|landmark|vista|estella|chung cư|chung cu|toà|tòa)\b/i;

interface Parsed { building?: string; street?: string; ward?: string; district?: string }

function districtVi(name: string): string {
  const n = name.match(/^(\d{1,2})$/);
  if (n) return `Quận ${Number(n[1])}`;
  const code = districtCodeOf(name);
  return code ? districtLabelVi(code) : name;
}

function parseLocation(location: string | null): Parsed {
  const out: Parsed = {};
  for (const raw of (location ?? '').split(',')) {
    const seg = raw.trim().replace(/\s+/g, ' ');
    if (!seg || CITY.test(seg)) continue;
    let m: RegExpMatchArray | null;
    if ((m = seg.match(/^(thu duc|thủ đức)( city)?$/i))) {
      out.district ??= 'Thủ Đức';
    } else if ((m = seg.match(/^(?:district|quận|quan|q\.)\s*(.+)$/i)) || (m = seg.match(/^(.+?)\s+district$/i))) {
      out.district ??= districtVi(m[1]);
    } else if ((m = seg.match(/^(?:ward|phường|phuong|p\.)\s*(.+)$/i)) || (m = seg.match(/^(.+?)\s+ward$/i))) {
      out.ward ??= `phường ${m[1]}`;
    } else if ((m = seg.match(/^(.+?)\s+street$/i)) || (m = seg.match(/^(?:street|đường|duong)\s*(.*)$/i))) {
      if (m[1].trim()) out.street ??= `đường ${m[1].trim()}`;
    } else if (/^\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)*\s+\D/.test(seg)) {
      // "35 Le Van Luong": a house number and its street, as precise as it gets.
      out.street ??= seg;
    } else if (BUILDING_WORD.test(seg) || /^the\s/i.test(seg)) {
      out.building ??= seg;
    }
  }
  return out;
}

// ── Reading a title ─────────────────────────────────────────────────────────
// The generated titles put the building after "in" or "at": "... Retreat in
// Lavida Plus with Modern Elegance", "Pool-View 2-Bedroom at Saigon Riverside".
// Title Case, so the name is the run of capitalised words up to a joining word.

const STOP = /^(with|near|for|and|featuring|offering|overlooking|by|from|on|in|at|of|to)$/i;
const FLUFF = /^(lush|vibrant|bustling|trendy|serene|lively|prestigious|iconic|upscale|luxurious|exclusive|popular|peaceful|quiet|charming|desirable|prime|modern|sought-after|the)$/i;
const NOT_A_PLACE = /^(heart|city|the city|downtown|saigon|sài gòn|ho chi minh|ho chi minh city|hcmc|centre|center|city centre|city center)$/i;

function isDistrictName(s: string): boolean {
  if (/^(quận|quan|district|q\.?)\s*\d/i.test(s) || /\bdistrict$/i.test(s)) return true;
  const code = districtCodeOf(s);
  // Only a district we know: districtCodeOf turns any short phrase into a code.
  return !!code && (/^D\d{1,2}$/.test(code) || districtLabelVi(code) !== districtLabel(code));
}

function buildingFromTitle(title: string | null): string | undefined {
  const words = (title ?? '').split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (!/^(in|at)$/i.test(words[i])) continue;
    const run: string[] = [];
    for (const w of words.slice(i + 1)) {
      const word = w.replace(/[,;|()]+$/, '');
      if (STOP.test(word) || word === '-' || !/^[\p{Lu}\d]/u.test(word)) break;
      run.push(word);
      if (word !== w) break; // punctuation ended it
    }
    while (run.length > 0 && FLUFF.test(run[0])) run.shift();
    const name = run.join(' ');
    if (!name || run.length > 5 || NOT_A_PLACE.test(name) || isDistrictName(name)) continue;
    return name;
  }
  return undefined;
}

/** "Lavida Plus, Quận 7", "đường Nguyen Thi Thap, phường Tan Phu, Quận 7", "Quận 2". */
function placeVi(l: UnitListing): string {
  const p = parseLocation(l.location);
  const district = p.district ?? (l.districtCode ? districtLabelVi(l.districtCode) : undefined);
  const building = p.building ?? buildingFromTitle(l.title);
  const parts = building
    ? [building, district]
    : [p.street, p.ward, district];
  return [...new Set(parts.filter((x): x is string => !!x))].join(', ');
}
