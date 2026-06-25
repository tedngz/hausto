/**
 * Lifestyle Knowledge Base for Hausto AI chat.
 *
 * Authoritative, curated facts about HCMC and Hanoi neighborhoods that the
 * chat-ai edge function injects into the system prompt when a user asks about
 * lifestyle, vibe, cost of living, safety, schools, food, or "best area for X".
 *
 * Keep entries:
 *   - factual & conservative (no invented prices)
 *   - written for premium long-stay expats (the Hausto target persona)
 *   - short (the whole block is sent to the model on every lifestyle turn)
 *
 * USD ranges are realistic 2024–2025 long-term lease figures for serviced /
 * mid-to-high end apartments. VND is reserved for actual listing cards.
 */

export type CostOfLiving = {
  rent1BR: [number, number]; // USD/mo, mid-to-high range
  rent2BR: [number, number];
  rent3BR: [number, number];
  diningOutMid: string;
  groceriesNote: string;
  transportNote: string;
};

export type DistrictKB = {
  city: 'ho chi minh' | 'hanoi';
  district: string; // canonical display name
  aliases: string[]; // lowercase, accent-stripped match keys
  vibe: string;
  bestFor: string[];
  notFor: string[];
  costOfLiving: CostOfLiving;
  food: string;
  schools: string;
  safety: string;
  expatFit: string;
  commute: string;
  notableComplexes: string[];
};

export type CityKB = {
  city: 'ho chi minh' | 'hanoi';
  aliases: string[];
  overview: string;
  costOfLivingSummary: string;
  bestAreasFor: Record<string, string>; // persona -> recommendation
};

// ─────────────────────────────────────────────────────────────────────────────
// CITY OVERVIEWS
// ─────────────────────────────────────────────────────────────────────────────

export const CITY_KB: CityKB[] = [
  {
    city: 'ho chi minh',
    aliases: ['ho chi minh', 'hcmc', 'hcm', 'saigon', 'sai gon', 'tphcm'],
    overview:
      'Ho Chi Minh City (Saigon) is Vietnam\'s commercial capital — fast, hot year-round, very motorbike-heavy, with the largest expat community in the country. The city is structured around the Saigon River; expats cluster in District 1 (CBD), District 2 / Thao Dien (leafy international enclave), District 7 / Phu My Hung (planned suburb), and increasingly District 3 and Binh Thanh.',
    costOfLivingSummary:
      'A comfortable expat lifestyle (modern 1BR + dining out 3–4×/week + Grab everywhere) runs roughly USD 1,500–2,500/month. A family with two kids in international school is typically USD 4,500–8,000/month all-in (school fees are the biggest line item, USD 15–35k/yr per child).',
    bestAreasFor: {
      families: 'Thao Dien (D2) for walkability + intl schools; Phu My Hung (D7) for planned, quiet, very international',
      'nightlife & dining': 'District 1 (Ben Nghe, Da Kao) and Thao Dien for craft cocktails / rooftop bars',
      'budget expats': 'Binh Thanh, Phu Nhuan, District 4 — all <15 min from D1, ~30–40% cheaper than D1',
      luxury: 'District 1 (Vinhomes Golden River, The Marq), Thu Thiem (Empire City), Thao Dien (Masteri, The River)',
      'digital nomads': 'Thao Dien for cafes + community; District 3 for cheaper rent + central; District 1 for max convenience',
      'short stay (3–6 months)': 'District 1 serviced apartments or Thao Dien — both have furnished month-to-month inventory',
    },
  },
  {
    city: 'hanoi',
    aliases: ['hanoi', 'ha noi'],
    overview:
      'Hanoi is the political and cultural capital — older, denser, more traditional, four real seasons (hot wet summer, chilly damp winter). Expat life centers on Tay Ho (West Lake — the Thao Dien equivalent), Ba Dinh (embassies + diplomatic), and Hoan Kiem (historic Old Quarter). Pace is slower than HCMC; rents are typically 10–20% lower for equivalent quality.',
    costOfLivingSummary:
      'Comfortable expat single: USD 1,300–2,200/month. Family with intl schooling: USD 4,000–7,500/month. Hanoi is meaningfully cheaper for groceries and street food than HCMC, slightly more expensive for imported wine/cheese.',
    bestAreasFor: {
      families: 'Tay Ho (West Lake) — most intl schools, lakeside walking, biggest expat community',
      diplomats: 'Ba Dinh — embassy row, quiet tree-lined streets, French-era villas',
      'culture lovers': 'Hoan Kiem (Old Quarter) — historic, walkable, food paradise, but tourist-heavy',
      'budget expats': 'Cau Giay, Hai Ba Trung — modern apartments at 30–40% off Tay Ho prices',
      'digital nomads': 'Tay Ho (cafes + community) or Dong Da (cheap + central)',
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HCMC DISTRICTS
// ─────────────────────────────────────────────────────────────────────────────

export const DISTRICT_KB: DistrictKB[] = [
  // ── HCMC ──────────────────────────────────────────────────────────────────
  {
    city: 'ho chi minh',
    district: 'District 1',
    aliases: ['district 1', 'd1', 'quan 1', 'q1', 'ben nghe', 'da kao', 'ben thanh'],
    vibe:
      'The downtown — luxury hotels, rooftop bars, Bitexco, Nguyen Hue walking street, the opera house. Dense, walkable by Vietnamese standards, traffic-heavy, never sleeps. Mix of colonial French villas, glass towers, and old shophouses.',
    bestFor: ['short stays', 'nightlife', 'business travelers', 'singles & couples', 'walkability'],
    notFor: ['families wanting outdoor space', 'quiet seekers', 'budget renters'],
    costOfLiving: {
      rent1BR: [900, 1800],
      rent2BR: [1500, 3000],
      rent3BR: [2500, 5000],
      diningOutMid: 'USD 10–25/meal at mid-range Western; USD 3–6 for great Vietnamese',
      groceriesNote: 'Annam Gourmet & Nam An Market for imported; weekly shop USD 80–150 for two',
      transportNote: 'Walk + Grab dominant; Metro Line 1 (D1 ↔ Suoi Tien) opens key stations 2024–2025',
    },
    food: 'World-class — from USD 2 pho on a plastic stool to USD 100 omakase. Best craft cocktails in Vietnam (Layla, Drinking & Healing, Stir).',
    schools: 'No major international schools in D1 itself; ISHCMC and BIS are 15–25 min away in D2/Binh Thanh.',
    safety: 'Very safe by SE Asia standards; main risk is phone snatching on motorbikes — keep phone away from the street side.',
    expatFit:
      'Best for first 3–12 months while you scout the city, or for couples/singles who prioritize being in the action. Most apartments are studio/1BR; family-size units exist but at a premium.',
    commute: '10–15 min Grab/bike to D3, 20 min to Thao Dien (rush hour can double this), 35–45 min to airport.',
    notableComplexes: ['Vinhomes Golden River', 'The Marq', 'Saigon Royal', 'Madison'],
  },
  {
    city: 'ho chi minh',
    district: 'District 3',
    aliases: ['district 3', 'd3', 'quan 3', 'q3'],
    vibe:
      'D1\'s quieter, leafier cousin — tree-lined streets, Notre Dame Cathedral, specialty coffee, indie boutiques. Many Vietnamese professionals and long-term expats live here for the central location without the D1 chaos.',
    bestFor: ['long-stay expats', 'cafe culture', 'value-vs-D1 seekers', 'professionals'],
    notFor: ['families needing intl schools nearby', 'pool/gym amenity hunters (older buildings)'],
    costOfLiving: {
      rent1BR: [700, 1400],
      rent2BR: [1200, 2400],
      rent3BR: [2000, 4000],
      diningOutMid: 'USD 8–20/meal; cheaper than D1 for the same quality',
      groceriesNote: 'Co.opmart + local wet markets; imported groceries require a Grab to D1',
      transportNote: 'Grab + own motorbike most common; Metro Line 1 has a Ba Son station on the D1/D3 border',
    },
    food: 'Vietnam\'s specialty coffee capital (The Workshop, Shin, %Arabica). Excellent mid-range Vietnamese and Korean.',
    schools: 'Some local bilingual schools; nearest large intl schools are in D2 (20–25 min).',
    safety: 'Very safe; same phone-snatching caveat as D1.',
    expatFit: 'Sweet spot for 1–3 year expats who want central life at 25–30% off D1 prices.',
    commute: '10 min to D1, 25 min to Thao Dien, 35 min to airport.',
    notableComplexes: ['Leman Luxury', 'Serenity Sky Villas', 'older serviced apartment buildings'],
  },
  {
    city: 'ho chi minh',
    district: 'District 4',
    aliases: ['district 4', 'd4', 'quan 4', 'q4'],
    vibe:
      'Tiny former-rough district directly across the Khanh Hoi bridge from D1, now gentrifying fast. Famous for Vinh Khanh seafood street and waterfront views back at D1\'s skyline. Mix of new high-rises and dense local alleys.',
    bestFor: ['value seekers within 5 min of D1', 'foodies (seafood)', 'young professionals'],
    notFor: ['families (limited green space)', 'noise-sensitive renters (alleys are loud)'],
    costOfLiving: {
      rent1BR: [500, 1100],
      rent2BR: [900, 1800],
      rent3BR: [1500, 2800],
      diningOutMid: 'USD 5–15/meal; legendary cheap seafood',
      groceriesNote: 'Local markets dominate; Annam Gourmet trip needed for imported',
      transportNote: 'Walking distance to D1 across one bridge; very bike-friendly',
    },
    food: 'Vinh Khanh seafood street is a destination. Otherwise mostly local Vietnamese.',
    schools: 'None international; rely on D2/Binh Thanh.',
    safety: 'Safe now; was rougher 10 years ago but fully gentrified along the waterfront.',
    expatFit: 'Great for a single/couple who wants D1 lifestyle at a 30–40% discount.',
    commute: '5 min to D1, 25 min to Thao Dien, 30 min to airport.',
    notableComplexes: ['Saigon Royal', 'The Tresor', 'Millennium', 'Riverside 90'],
  },
  {
    city: 'ho chi minh',
    district: 'District 7',
    aliases: ['district 7', 'd7', 'quan 7', 'q7', 'phu my hung', 'pmh', 'phu my hung'],
    vibe:
      'Planned township built by a Taiwanese developer in the 1990s — wide boulevards, grid streets, manicured parks, the largest international community (Korean + Japanese + Taiwanese + Western families). Feels like a clean suburb of Singapore, not Vietnam.',
    bestFor: ['families', 'long-stay (3+ years)', 'people who hate motorbike chaos', 'walkability'],
    notFor: ['nightlife seekers', 'people needing to be in D1 daily', 'authenticity hunters'],
    costOfLiving: {
      rent1BR: [600, 1300],
      rent2BR: [1000, 2200],
      rent3BR: [1800, 4000],
      diningOutMid: 'USD 10–25/meal; strong Korean, Japanese, Western, weak local Vietnamese',
      groceriesNote: 'Crescent Mall + SC VivoCity + Annam; family-friendly, full imported selection',
      transportNote: 'Own car or motorbike strongly recommended; Grab works but is slow at rush hour',
    },
    food: 'Best Korean food in HCMC. Many family-friendly Western restaurants. Mediocre street food scene.',
    schools: 'Saigon South International (SSIS), Renaissance, Canadian International — all within PMH itself.',
    safety: 'Safest area in HCMC; gated complexes, low crime, kids can play outside.',
    expatFit:
      'The default choice for expat families with school-age kids and 2+ year assignments. Less interesting if you\'re single or want urban energy.',
    commute: '25–35 min to D1 (rush hour can hit 60 min via Khanh Hoi bridge), 25 min to airport.',
    notableComplexes: ['The Crescent', 'Riviera Point', 'Sunrise City', 'Scenic Valley', 'Happy Valley'],
  },
  {
    city: 'ho chi minh',
    district: 'Thao Dien',
    aliases: ['thao dien', 'thao dien ward', 'd2 thao dien', 'an phu thao dien'],
    vibe:
      'The most Western-feeling neighborhood in Vietnam — leafy, riverside, walkable, dense with cafes, brunch spots, yoga studios, and international schools. Originally a French diplomat enclave, now the default landing pad for Western expats. Feels nothing like the rest of HCMC.',
    bestFor: ['Western expats', 'families', 'long-stay', 'cafe & brunch lovers', 'people who want a walkable bubble'],
    notFor: ['budget renters', 'people needing to be in D1 daily', 'those wanting authentic Vietnam'],
    costOfLiving: {
      rent1BR: [800, 1600],
      rent2BR: [1300, 2800],
      rent3BR: [2200, 5000],
      diningOutMid: 'USD 12–30/meal at the dense Western restaurant strip',
      groceriesNote: 'Annam Gourmet (full imported), Farmers Market on weekends, organic delivery services',
      transportNote: 'Walk + bike within Thao Dien; Grab/own motorbike for D1; Metro Line 1 An Phu station',
    },
    food: 'Brunch capital of Vietnam — Snap Cafe, The Refinery, Soul Burger, Pizza 4Ps. Strong craft beer + natural wine scene.',
    schools: 'ISHCMC, BIS HCMC, AIS, EIS — all within 10 min. The biggest reason families choose Thao Dien.',
    safety: 'Very safe; gated complexes are normal; lowest motorbike-snatching rate of the central areas.',
    expatFit:
      'The single best fit for a Western family or long-stay expat couple. Most apartments are modern with pool & gym. Downside: you can go weeks without speaking Vietnamese, and rents are at the top end.',
    commute: '20 min to D1 (40 min in rush hour via Saigon Bridge), 10 min to Thu Thiem, 30 min to airport.',
    notableComplexes: ['Masteri Thao Dien', 'The Estella', 'The Vista', 'The River Thao Dien', 'Gateway', 'Estella Heights'],
  },
  {
    city: 'ho chi minh',
    district: 'An Phu',
    aliases: ['an phu', 'an phu ward', 'd2 an phu'],
    vibe:
      'Directly inland from Thao Dien, less leafy but cheaper and very close to all the same amenities. Mix of older villa compounds and new mid-rises. Quieter than Thao Dien core.',
    bestFor: ['families wanting Thao Dien access at lower cost', 'long-stay'],
    notFor: ['walkability purists (more sprawled than Thao Dien)'],
    costOfLiving: {
      rent1BR: [600, 1300],
      rent2BR: [1000, 2200],
      rent3BR: [1800, 3800],
      diningOutMid: 'USD 10–25/meal',
      groceriesNote: 'Walk/bike to Annam in Thao Dien',
      transportNote: 'Bike + Grab; close to An Phu metro station',
    },
    food: '5–10 min bike to all of Thao Dien\'s restaurant scene.',
    schools: 'BIS HCMC and ISHCMC campuses are in/adjacent to An Phu.',
    safety: 'Very safe.',
    expatFit: 'Great compromise — Thao Dien-adjacent lifestyle at 15–25% lower rent.',
    commute: '20 min to D1, 5 min to Thao Dien core.',
    notableComplexes: ['Estella Heights', 'Cantavil An Phu', 'Parc Spring'],
  },
  {
    city: 'ho chi minh',
    district: 'Thu Thiem',
    aliases: ['thu thiem', 'thu thiem peninsula', 'empire city'],
    vibe:
      'HCMC\'s planned new CBD across the river from D1 — a massive ongoing development with Empire City, Eco Smart City, and the Thu Thiem 2 bridge. Currently a mix of finished luxury towers and construction sites. Long-term: this is meant to be the next financial center.',
    bestFor: ['ultra-luxury renters', 'investors', 'people who want brand-new buildings'],
    notFor: ['short-stay (still developing)', 'budget renters', 'people needing dense street life'],
    costOfLiving: {
      rent1BR: [1000, 2200],
      rent2BR: [1800, 4000],
      rent3BR: [3000, 8000],
      diningOutMid: 'USD 15–35/meal at hotel restaurants; limited street food',
      groceriesNote: 'Mall-based; full imported at Vincom Center',
      transportNote: '2 min tunnel to D1; very car-friendly, less bike-friendly than D1',
    },
    food: 'Limited but growing — mostly hotel and mall restaurants.',
    schools: 'European International School (EIS) and Vietnam Australia International School (VAS) nearby.',
    safety: 'Extremely safe; gated, low-density.',
    expatFit: 'For C-suite or finance expats who want a brand-new luxury tower across the bridge from work in D1.',
    commute: '5–10 min to D1 via tunnel, 12 min to Thao Dien, 30 min to airport.',
    notableComplexes: ['Empire City', 'The River Thu Thiem', 'Sala (Sarimi, Sadora, Sarica)', 'Metropole Thu Thiem'],
  },
  {
    city: 'ho chi minh',
    district: 'Binh Thanh',
    aliases: ['binh thanh', 'quan binh thanh'],
    vibe:
      'Big, varied district wrapping around D1 — Landmark 81 (Vietnam\'s tallest building) is here. Mix of new Vinhomes Central Park towers, older local neighborhoods, and the Saigon Pearl complex on the river.',
    bestFor: ['value within 10 min of D1', 'tower-with-amenities renters', 'professionals'],
    notFor: ['families seeking schools within walking distance', 'low-rise village atmosphere seekers'],
    costOfLiving: {
      rent1BR: [600, 1400],
      rent2BR: [1100, 2400],
      rent3BR: [1800, 4000],
      diningOutMid: 'USD 8–20/meal; everything from local pho to mall sushi',
      groceriesNote: 'Vincom Landmark 81 has full imported selection',
      transportNote: 'Bike + Grab; very close to D1 bridges',
    },
    food: 'Strong mid-range; Landmark 81\'s upper floors have skyline-view restaurants.',
    schools: 'Some local bilingual options; international schools 15–25 min away.',
    safety: 'Safe.',
    expatFit: 'Excellent for professionals who want a modern tower with pool/gym at 30% less than D1.',
    commute: '5–15 min to D1, 20 min to Thao Dien, 35 min to airport.',
    notableComplexes: ['Vinhomes Central Park (Landmark 81)', 'Saigon Pearl', 'City Garden', 'The Manor'],
  },
  {
    city: 'ho chi minh',
    district: 'Phu Nhuan',
    aliases: ['phu nhuan', 'quan phu nhuan'],
    vibe:
      'Quiet residential district between D1 and the airport, full of local Vietnamese professional families. Less expat presence than D1/D3/D2 but very convenient and authentic.',
    bestFor: ['budget-conscious expats', 'people commuting to the airport often', 'authentic local life'],
    notFor: ['English-only renters (less English spoken)', 'nightlife'],
    costOfLiving: {
      rent1BR: [400, 900],
      rent2BR: [700, 1500],
      rent3BR: [1200, 2500],
      diningOutMid: 'USD 5–12/meal; mostly local Vietnamese',
      groceriesNote: 'Co.opmart + local markets; trip to D1/D2 for imported',
      transportNote: 'Bike strongly recommended; 10 min to D1, 10 min to airport',
    },
    food: 'Excellent local Vietnamese, limited Western.',
    schools: 'Local schools only.',
    safety: 'Very safe; residential vibe.',
    expatFit: 'For expats who\'ve been here 1+ year and want to spend less / live more like a local.',
    commute: '10 min to D1, 10 min to airport, 25 min to Thao Dien.',
    notableComplexes: ['Garden Gate', 'Botanica Premier', 'Newton Residence'],
  },

  // ── HANOI ─────────────────────────────────────────────────────────────────
  {
    city: 'hanoi',
    district: 'Hoan Kiem',
    aliases: ['hoan kiem', 'old quarter', 'hk', 'quan hoan kiem'],
    vibe:
      'Hanoi\'s historic heart — Hoan Kiem Lake, the Old Quarter\'s 36 streets, French Quarter villas. Tourist-dense but also where many wealthy Vietnamese live. Best food street in Vietnam.',
    bestFor: ['short stays', 'food lovers', 'walkability', 'culture immersion'],
    notFor: ['quiet seekers', 'families needing space', 'noise-sensitive renters'],
    costOfLiving: {
      rent1BR: [600, 1300],
      rent2BR: [1100, 2400],
      rent3BR: [1800, 4000],
      diningOutMid: 'USD 6–20/meal; street food USD 2–4 is world-class',
      groceriesNote: 'Local markets dominate; Annam Gourmet on Ly Thai To for imported',
      transportNote: 'Walking + Grab; very bike-unfriendly due to narrow streets',
    },
    food: 'Hanoi\'s — and arguably Vietnam\'s — best street food scene. Bun cha, pho, cha ca, egg coffee all originated near here.',
    schools: 'None international in district.',
    safety: 'Very safe; tourist pickpocketing is the main risk.',
    expatFit: 'Great for 3–12 month stays or culture-first expats. Long-term: noise and lack of modern amenities push most expats to Tay Ho.',
    commute: 'Central — 15 min to Tay Ho, 10 min to Ba Dinh, 35 min to airport.',
    notableComplexes: ['Hanoi Lake View', 'Pacific Place', 'Press Club'],
  },
  {
    city: 'hanoi',
    district: 'Ba Dinh',
    aliases: ['ba dinh', 'quan ba dinh'],
    vibe:
      'Embassy row and the political district — Ho Chi Minh Mausoleum, presidential palace, dozens of embassies, French colonial villas on tree-lined streets. Quiet, leafy, prestigious.',
    bestFor: ['diplomats', 'families wanting villas', 'quiet seekers', 'long-stay'],
    notFor: ['budget renters', 'nightlife', 'modern high-rise amenity hunters'],
    costOfLiving: {
      rent1BR: [700, 1400],
      rent2BR: [1300, 2800],
      rent3BR: [2200, 5000],
      diningOutMid: 'USD 10–25/meal',
      groceriesNote: 'Annam Gourmet + Lotte Mart in Lieu Giai',
      transportNote: 'Walk + bike + Grab; quietest traffic of the central districts',
    },
    food: 'Strong mix of local + diplomatic-quarter Western/Japanese restaurants.',
    schools: 'United Nations International School (UNIS) is close; several embassy-affiliated schools.',
    safety: 'Among the safest in Hanoi due to embassy security presence.',
    expatFit: 'Default for diplomats and senior expats who want villa living near the center.',
    commute: '10 min to Hoan Kiem, 15 min to Tay Ho, 30 min to airport.',
    notableComplexes: ['Lancaster Hanoi', 'Sun Grand City Ancora', 'Vinhomes Metropolis'],
  },
  {
    city: 'hanoi',
    district: 'Tay Ho',
    aliases: ['tay ho', 'west lake', 'ho tay', 'quan tay ho'],
    vibe:
      'Hanoi\'s Thao Dien — wraps the huge West Lake, full of Western expats, brunch cafes, yoga, international schools, lakeside running paths. The default expat landing zone in Hanoi.',
    bestFor: ['Western expats', 'families', 'long-stay', 'lake/outdoor lifestyle'],
    notFor: ['those needing to be in Hoan Kiem daily', 'budget renters'],
    costOfLiving: {
      rent1BR: [700, 1500],
      rent2BR: [1300, 2600],
      rent3BR: [2200, 4500],
      diningOutMid: 'USD 12–28/meal; dense Western restaurant strip on Xuan Dieu',
      groceriesNote: 'L\'s Place, Annam Gourmet on Xuan Dieu, organic delivery services',
      transportNote: 'Bike or own motorbike; Grab works; running/walking around the lake is a lifestyle perk',
    },
    food: 'Brunch capital of Hanoi (Maison de Tet Decor, The Hanoi Social Club, Pizza 4Ps). Strong specialty coffee.',
    schools: 'UNIS, Concordia, St Paul American, Hanoi Academy — all within 15 min.',
    safety: 'Very safe; gated villas and modern compounds are common.',
    expatFit: 'The best fit for a Western family or long-stay couple in Hanoi. Most apartments are modern with amenities.',
    commute: '15 min to Hoan Kiem, 25 min to airport (closer than central districts).',
    notableComplexes: ['Sun Grand City', 'Watermark', 'Golden Westlake', 'Elegant Suites', 'Oakwood Residence'],
  },
  {
    city: 'hanoi',
    district: 'Cau Giay',
    aliases: ['cau giay', 'quan cau giay'],
    vibe:
      'Modern western Hanoi — universities, tech offices (Vingroup, FPT), new high-rise apartment complexes. Younger, professional, very Vietnamese (not many expats).',
    bestFor: ['budget-conscious expats', 'tech workers', 'modern high-rise renters'],
    notFor: ['those wanting expat community', 'central-city lovers'],
    costOfLiving: {
      rent1BR: [400, 900],
      rent2BR: [700, 1500],
      rent3BR: [1200, 2500],
      diningOutMid: 'USD 6–15/meal',
      groceriesNote: 'Big C, Vincom Mall full imported selection',
      transportNote: 'Bike + Grab; near Metro Line 2A (Cat Linh–Ha Dong), 22 min to Hoan Kiem',
    },
    food: 'Strong mid-range Vietnamese + Korean; weaker Western scene.',
    schools: 'Some bilingual schools; international schools require 15–20 min commute to Tay Ho.',
    safety: 'Safe.',
    expatFit: 'Great value for solo expats or couples wanting modern amenities at 30–40% off Tay Ho.',
    commute: '22 min to Hoan Kiem, 15 min to Tay Ho, 35 min to airport.',
    notableComplexes: ['Indochina Plaza Hanoi', 'Discovery Complex', 'Vinhomes D\'Capitale'],
  },
  {
    city: 'hanoi',
    district: 'Hai Ba Trung',
    aliases: ['hai ba trung', 'quan hai ba trung'],
    vibe:
      'Dense central district south of Hoan Kiem — Vincom Center Ba Trieu, mix of old French villas and new towers. Less touristy than Hoan Kiem, very local energy.',
    bestFor: ['value central living', 'long-stay locals + expats'],
    notFor: ['expat-community seekers'],
    costOfLiving: {
      rent1BR: [500, 1100],
      rent2BR: [900, 1900],
      rent3BR: [1500, 3200],
      diningOutMid: 'USD 6–18/meal',
      groceriesNote: 'Vincom Ba Trieu, local markets',
      transportNote: 'Bike + Grab; 10–15 min to Hoan Kiem',
    },
    food: 'Excellent local; some good mid-range Western.',
    schools: 'Local schools; intl schools 20+ min in Tay Ho.',
    safety: 'Safe.',
    expatFit: 'Solid for expats who\'ve done Tay Ho once and want something cheaper + more local.',
    commute: '10 min to Hoan Kiem, 25 min to Tay Ho, 30 min to airport.',
    notableComplexes: ['Vincom Center Ba Trieu apartments', 'Hanoi Center Point', 'Times City (in nearby Hoang Mai)'],
  },
  {
    city: 'hanoi',
    district: 'Dong Da',
    aliases: ['dong da', 'quan dong da'],
    vibe:
      'Big, dense, very local district just southwest of the center — universities, hospitals, modest local apartments. Cheap, central, no expat infrastructure.',
    bestFor: ['budget expats', 'students', 'long-term locals'],
    notFor: ['anyone needing English-speaking services nearby', 'amenity hunters'],
    costOfLiving: {
      rent1BR: [350, 800],
      rent2BR: [600, 1300],
      rent3BR: [1000, 2200],
      diningOutMid: 'USD 4–12/meal; mostly local',
      groceriesNote: 'Local markets + Co.opmart',
      transportNote: 'Bike essential; 15 min to Hoan Kiem',
    },
    food: 'Excellent cheap local food; minimal Western options.',
    schools: 'Local schools only.',
    safety: 'Safe.',
    expatFit: 'For seasoned expats or budget travelers who want to live like locals.',
    commute: '15 min to Hoan Kiem, 30 min to Tay Ho.',
    notableComplexes: ['Hanoi Royal City (mixed-use)', 'older local apartment blocks'],
  },
  {
    city: 'hanoi',
    district: 'Long Bien',
    aliases: ['long bien', 'quan long bien'],
    vibe:
      'Across the Red River from central Hanoi, connected by the iconic Chuong Duong and Long Bien bridges. Mix of new Vinhomes Riverside compounds and traditional river villages. Much greener and quieter than the central districts.',
    bestFor: ['families wanting villa compounds', 'quiet + green seekers', 'long-stay'],
    notFor: ['people needing to be in Hoan Kiem daily', 'walkable urban life'],
    costOfLiving: {
      rent1BR: [400, 1000],
      rent2BR: [800, 1800],
      rent3BR: [1400, 3500],
      diningOutMid: 'USD 8–20/meal; mall-based',
      groceriesNote: 'AEON Mall Long Bien is a major draw — full Japanese-style supermarket',
      transportNote: 'Car or motorbike required; 18 min to Hoan Kiem via bridge',
    },
    food: 'Limited; mall + compound restaurants dominate.',
    schools: 'Vinschool inside Vinhomes Riverside; intl schools require commute to Tay Ho.',
    safety: 'Very safe; gated compounds.',
    expatFit: 'Best for families wanting a villa or townhouse at meaningfully lower cost than Tay Ho.',
    commute: '18 min to Hoan Kiem, 30 min to Tay Ho, 30 min to airport.',
    notableComplexes: ['Vinhomes Riverside', 'Vinhomes Symphony', 'Berriver Long Bien'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function stripAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Detect whether a user turn is a "lifestyle" question (info/advice) rather
 * than a shopping query. Used by chat-ai to skip the heavy property block.
 */
// Multi-word phrases that unambiguously request info/advice (NOT listings).
// Keep these specific — bare words like "safe" or "schools" fire on normal
// shopping turns ("safe 2BR near international school") and would suppress
// property cards.
const LIFESTYLE_TRIGGERS = [
  'best place to live', 'best area to live', 'where should i live', 'where to live',
  'best neighborhood', 'best district', 'good for families', 'good for kids',
  'is it safe', 'how safe', 'cost of living', 'how much does it cost', 'how expensive',
  "what's the vibe", 'what is the vibe', 'what is it like', "what's it like",
  'tell me about', 'describe the', 'pros and cons', 'pros & cons',
  ' vs ', ' versus ', 'compare ',
  'food scene', 'nightlife scene', 'restaurant scene',
  'recommend an area', 'recommend a district', 'which area', 'which district',
  'should i pick', 'should i choose', 'should i live',
  'overview of', 'guide to', 'living in',
];

// Phrases that signal the user wants actual listings.
const SHOPPING_TRIGGERS = [
  'show me', 'find me', 'looking for', 'i want', 'i need', 'i\'m looking',
  'under ', 'less than ', 'below ', 'budget',
  'available', 'listings', 'listing', 'apartments for rent', 'show properties',
  'apartment', 'apartments', 'flat', 'flats', 'condo', 'condos', 'studio',
  'place to rent', 'places to rent', 'for rent', 'rent in', 'rent a',
  'something in', 'options in', 'units in', 'available in',
  'any 2br', 'any 3br', 'any 1br', 'any studio',
  'show me a', 'do you have', 'got any',
];

// Hard override — if any of these appear, the user is clearly shopping and
// must never have property results suppressed.
const SHOPPING_KEYWORD_RE =
  /\b(apartment|apartments|flat|flats|condo|condos|studio|listing|listings|for rent|rent in|rent a|\d+\s*br|\d+\s*bedroom|bedrooms?)\b/i;

export function hasShoppingKeyword(message: string): boolean {
  return SHOPPING_KEYWORD_RE.test(stripAccents(message || ''));
}

export function detectLifestyleIntent(message: string): {
  isLifestyle: boolean;
  isMixed: boolean;
} {
  const lc = stripAccents(message || '');
  const hasLifestyle = LIFESTYLE_TRIGGERS.some(t => lc.includes(t));
  const hasShopping = SHOPPING_TRIGGERS.some(t => lc.includes(t));
  // bedroom/budget patterns also signal shopping
  const hasShoppingNumeric =
    /\b\d+\s*(br|bedroom|phong ngu)\b/.test(lc) ||
    /\b\d+\s*(m|million|tr|trieu)\b/.test(lc) ||
    /\$\s*\d/.test(lc);

  const shoppingSignal = hasShopping || hasShoppingNumeric || SHOPPING_KEYWORD_RE.test(lc);
  return {
    // Pure lifestyle ONLY when there's no shopping signal at all.
    isLifestyle: hasLifestyle && !shoppingSignal,
    isMixed: hasLifestyle && shoppingSignal,
  };
}

export type KBLookup = {
  cityEntries: CityKB[];
  districtEntries: DistrictKB[];
};

/**
 * Find KB entries relevant to the user's message + accumulated context.
 * Returns at most 1 city overview and up to 3 district entries.
 */
export function findRelevantKB(
  message: string,
  accContext?: { city?: string; specificDistricts?: string[] }
): KBLookup {
  const lc = stripAccents(message || '');
  const districtEntries: DistrictKB[] = [];
  const seen = new Set<string>();

  // Match by aliases in message text
  for (const entry of DISTRICT_KB) {
    if (entry.aliases.some(a => lc.includes(stripAccents(a)))) {
      if (!seen.has(entry.district)) {
        districtEntries.push(entry);
        seen.add(entry.district);
      }
    }
  }

  // Match by accumulated context (specific districts already extracted)
  const ctxDistricts = (accContext?.specificDistricts || []).map(stripAccents);
  for (const entry of DISTRICT_KB) {
    if (districtEntries.length >= 3) break;
    if (seen.has(entry.district)) continue;
    if (entry.aliases.some(a => ctxDistricts.some(cd => cd.includes(stripAccents(a))))) {
      districtEntries.push(entry);
      seen.add(entry.district);
    }
  }

  // Find the relevant city overview
  let cityEntries: CityKB[] = [];
  for (const c of CITY_KB) {
    if (c.aliases.some(a => lc.includes(a))) {
      cityEntries.push(c);
    }
  }
  // If no explicit city mention but matched districts give us one, include that city
  if (cityEntries.length === 0 && districtEntries.length > 0) {
    const cityName = districtEntries[0].city;
    const cityEntry = CITY_KB.find(c => c.city === cityName);
    if (cityEntry) cityEntries = [cityEntry];
  }
  // If accContext has a city and we still have nothing, include it
  if (cityEntries.length === 0 && accContext?.city) {
    const cityName = accContext.city === 'hcm' ? 'ho chi minh' : accContext.city === 'hanoi' ? 'hanoi' : null;
    if (cityName) {
      const cityEntry = CITY_KB.find(c => c.city === cityName);
      if (cityEntry) cityEntries = [cityEntry];
    }
  }

  return { cityEntries, districtEntries: districtEntries.slice(0, 3) };
}

/**
 * Format a KB lookup as a compact prompt block.
 */
export function formatKBBlock(kb: KBLookup): string {
  if (kb.cityEntries.length === 0 && kb.districtEntries.length === 0) return '';

  const cityPart = kb.cityEntries
    .map(c => {
      const personas = Object.entries(c.bestAreasFor)
        .map(([k, v]) => `    - ${k}: ${v}`)
        .join('\n');
      return `City: ${c.city.toUpperCase()}
  overview: ${c.overview}
  cost_of_living_summary: ${c.costOfLivingSummary}
  best_areas_for:
${personas}`;
    })
    .join('\n\n');

  const districtPart = kb.districtEntries
    .map(d => {
      const col = d.costOfLiving;
      return `District: ${d.district} (${d.city})
  vibe: ${d.vibe}
  best_for: ${d.bestFor.join(', ')}
  not_for: ${d.notFor.join(', ')}
  rent_usd_per_month: 1BR ${col.rent1BR[0]}–${col.rent1BR[1]}, 2BR ${col.rent2BR[0]}–${col.rent2BR[1]}, 3BR ${col.rent3BR[0]}–${col.rent3BR[1]}
  dining: ${col.diningOutMid}
  groceries: ${col.groceriesNote}
  transport: ${col.transportNote}
  food_scene: ${d.food}
  schools: ${d.schools}
  safety: ${d.safety}
  expat_fit: ${d.expatFit}
  commute: ${d.commute}
  notable_complexes: ${d.notableComplexes.join(', ')}`;
    })
    .join('\n\n');

  return `\n🏘️ LIFESTYLE KNOWLEDGE (AUTHORITATIVE — quote facts from here, do NOT invent prices, schools, or commute times):
${[cityPart, districtPart].filter(Boolean).join('\n\n')}\n`;
}
