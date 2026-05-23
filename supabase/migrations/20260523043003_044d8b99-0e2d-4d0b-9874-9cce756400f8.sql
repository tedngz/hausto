
-- 1) Aggregate real listing images per complex (gallery + hero)
WITH all_imgs AS (
  SELECT c.id AS cid, unnest(ep.images) AS img, ep.crawled_at AS ts
  FROM public.complexes c
  JOIN public.external_properties ep
    ON (ep.title ILIKE '%'||c.name||'%' OR ep.location ILIKE '%'||c.name||'%')
  WHERE ep.images IS NOT NULL AND ep.is_active = true
  UNION ALL
  SELECT c.id AS cid, unnest(p.images) AS img, p.last_activated_at AS ts
  FROM public.complexes c
  JOIN public.properties p
    ON (p.title ILIKE '%'||c.name||'%' OR p.location ILIKE '%'||c.name||'%' OR p.description ILIKE '%'||c.name||'%')
  WHERE p.images IS NOT NULL AND p.is_active = true
),
ranked AS (
  SELECT cid, img, ts,
         row_number() OVER (PARTITION BY cid ORDER BY ts DESC NULLS LAST) AS rn
  FROM all_imgs
  WHERE img IS NOT NULL AND img <> ''
),
agg AS (
  SELECT cid, array_agg(img ORDER BY rn) FILTER (WHERE rn <= 8) AS imgs
  FROM ranked GROUP BY cid
)
UPDATE public.complexes c
SET gallery   = agg.imgs,
    hero_image = COALESCE(agg.imgs[1], c.hero_image),
    updated_at = now()
FROM agg
WHERE c.id = agg.cid AND agg.imgs IS NOT NULL AND array_length(agg.imgs,1) > 0;

-- 2) Enrich flagship complexes with rich environment / amenity / insider context
WITH data(slug, descr, amen, pros, cons, commute) AS (VALUES
  (
    'vinhomes-central-park',
    'Sprawled across 43 hectares along the Saigon River, Vinhomes Central Park is the closest thing HCMC has to a self-contained township. Anchored by the 81-storey Landmark 81, residents wake up to riverfront jogging paths, a 14-hectare central park, and a Vincom Mega Mall at the podium. The vibe is family-driven and international: a Vinschool, Vinmec hospital, and Saigon Sports Club sit inside the gates, so most weekly errands never require leaving the compound.',
    ARRAY['Riverfront park (14 ha)','Olympic-size pool & lap pool','Vincom Mega Mall','Vinschool & Vinmec hospital','Saigon Sports Club','Kids splash zone','BBQ pavilions','24/7 security & shuttle bus'],
    ARRAY['Self-contained township — schools, hospital, mall all on-site','Landmark riverfront views in Park / Landmark towers','Strong resale & rental liquidity','Excellent for families and pet owners'],
    ARRAY['Traffic at the single Nguyen Huu Canh gate during peak hours','Older Park towers (1–7) show wear in lobbies','Some units face the highway — verify orientation'],
    '{"District 1 (Ben Thanh)":"10–15 min by car","Thao Dien expat hub":"15 min","Tan Son Nhat airport":"25–35 min","International School (ISHCMC)":"20 min"}'::jsonb
  ),
  (
    'masteri-thao-dien',
    'Masteri Thao Dien set the template for Saigon''s modern expat enclave. Five towers sit directly above Vincom Mega Mall Thao Dien and a metro line 1 station, with a long riverside promenade and a 50m pool deck overlooking District 1. The crowd skews young professional, with Korean, Japanese, and Western tenants drawn by walkability to Thao Dien''s bars, cafés, and international schools.',
    ARRAY['Riverside infinity pool','Vincom Mega Mall (B1 access)','Metro Line 1 station at podium','Sky Garden & jogging track','Gym & yoga studio','Kids playroom','Co-working lounge','Pet-friendly common areas'],
    ARRAY['Walkable to Thao Dien expat strip','Direct mall + metro access from the building','High-floor District 1 skyline views','Pet-friendly policy enforced'],
    ARRAY['Saturday mall traffic clogs the entrance','Some lower-floor units face the highway','Premium rents — value tightens vs. newer Lumiere'],
    '{"District 1":"15–20 min","BIS / ISHCMC":"8–12 min","Tan Son Nhat airport":"30 min","Landmark 81 / VHCP":"10 min"}'::jsonb
  ),
  (
    'the-marq-d1',
    'Tucked on Nguyen Dinh Chieu in the embassy quarter of District 1, The Marq is Hongkong Land + Hoa Lam''s discreet, low-density alternative to mega-projects. Just 515 units across two towers, with a porte-cochère arrival, hotel-style concierge, and interiors fitted by Bensley Studio. Walk-to-work convenience for finance and consulate professionals based around Ho Con Rua and Le Duan.',
    ARRAY['Hotel-style concierge & valet','Sky pool with skyline views','Private clubhouse & wine cellar','State-of-the-art gym','Spa & treatment rooms','Kids'' club','Curated landscaping by Bensley','Private lift lobbies for premium units'],
    ARRAY['Walk to consulates, Ben Thanh, Notre Dame','Bensley-designed gardens & arrival','Boutique scale — only 515 units','Hongkong Land asset management standards'],
    ARRAY['Premium pricing — among the most expensive per sqm in D1','No mall on podium (by design)','Limited parking for guests'],
    '{"Ben Thanh Market":"5 min walk","Saigon Centre / Takashimaya":"5 min walk","Tan Son Nhat airport":"20–25 min","Thao Dien":"15 min by car"}'::jsonb
  ),
  (
    'empire-city',
    'Empire City is the flagship of the Thu Thiem skyline — a Keppel-Tien Phuoc-Tran Thai-Gaw joint venture rising opposite District 1 across the Saigon River. The Linden, Tilia, and Cove Residences sit beside the Empire 88 supertall and a riverside boulevard. The vibe is "new Saigon": glassy, walkable, with rooftop infinity pools framing the District 1 skyline. Popular with senior expats from finance and tech who want short cross-river commutes.',
    ARRAY['Riverside infinity pool with D1 view','Sky lounge & co-working','Concierge & valet','Sunken garden & BBQ deck','Kids'' club & playground','Gym with personal training','Pet relief areas','Private wine cellar'],
    ARRAY['Best skyline view of District 1 in the city','Brand-new Keppel-grade management','Quiet, low-density Thu Thiem setting','Walking access to Saigon River promenade'],
    ARRAY['Thu Thiem still maturing — fewer street-level cafés','Bridge / tunnel bottleneck on weekday peak','High service fees vs. older buildings'],
    '{"District 1 (via Thu Thiem tunnel)":"8–12 min","Thao Dien":"10 min","Tan Son Nhat airport":"25–30 min","ISHCMC American Academy":"5 min"}'::jsonb
  ),
  (
    'the-metropole-thu-thiem',
    'SonKim Land''s The Metropole is Thu Thiem''s closest answer to a European boulevard — four phases (Galleria, Opera, Crystal, Ballet) of branded residences set around tree-lined avenues and a future opera house. The Sofitel-managed Crystal residences raise the bar for hotel-style living in Saigon, with floor-to-ceiling glass facing the river and direct access to Eaton House Thu Thiem International School.',
    ARRAY['Sofitel-style concierge (Crystal)','Sky pool with river view','Private dining rooms','State-of-the-art gym & spa','Walking distance to Eaton House school','Boulevard cafés & boutiques','Pet-friendly courtyards','24/7 valet'],
    ARRAY['Branded residence-grade fit-out and service','Walking-distance international school','Quiet, master-planned streets','Strong rental demand from financial expats'],
    ARRAY['Top-of-market rents — Crystal commands premium','Public transport still limited in Thu Thiem','Some early phases (Galleria) feel less finished'],
    '{"District 1 (via tunnel)":"10 min","Eaton House Thu Thiem":"5 min walk","Tan Son Nhat airport":"30 min","Thao Dien":"15 min"}'::jsonb
  ),
  (
    'celadon-city',
    'Gamuda Land''s Celadon City is a 82-hectare Malaysian-style township in Tan Phu — one of HCMC''s largest green developments. The 16-hectare Central Park, sports complex, and on-site international school (Sakura Montessori) make it one of the few HCMC complexes that genuinely works as a self-contained family suburb. Rents are noticeably softer than central districts for similar build quality.',
    ARRAY['16-hectare Central Park','Olympic-size pool & sports complex','Aeon Mall Tan Phu next door','Sakura Montessori inside','Jogging & cycling tracks','BBQ pavilions','Kids playground','24/7 security'],
    ARRAY['Most green space per resident of any HCMC complex','Excellent value vs. Thao Dien / D1 for families','Aeon Mall + Tan Son Nhat airport both close','Strong Korean & Japanese community'],
    ARRAY['Far from District 1 nightlife (30–40 min)','Tan Phu lacks expat bar / café density','Internal traffic during school pickup'],
    '{"District 1":"30–40 min","Tan Son Nhat airport":"15 min","Aeon Mall Tan Phu":"3 min walk","Saigon South / D7":"35 min"}'::jsonb
  ),
  (
    'vinhomes-grand-park',
    'Vinhomes Grand Park is Vingroup''s 271-hectare township in District 9 / Thu Duc — a "city within a city" with a 36-hectare central park (the largest in Southeast Asia), Vinschool, Vinmec, and Vincom Mega Mall on site. The newer Origami, Rainbow, and Glory Heights subzones offer modern, well-finished units at materially lower price points than central HCMC. Popular with families and remote-work expats.',
    ARRAY['36-hectare Grand Park (SEA''s largest)','Vincom Mega Mall','Vinschool & Vinmec hospital','Olympic pool & multiple kids'' pools','BBQ islands & lakeside dining','Sports complex (tennis, futsal)','24/7 shuttle bus','Pet-friendly subzones'],
    ARRAY['Largest green space + amenities of any VN complex','Excellent price per sqm vs. central HCMC','Family-first design — schools, hospital on-site','Newer phases (Glory Heights) very well finished'],
    ARRAY['1 hour to District 1 in traffic','Far from expat hubs (Thao Dien, D1)','Some early towers (S1–S3) showing wear'],
    '{"District 1":"45–60 min","Thao Dien":"30 min","Tan Son Nhat airport":"45–55 min","Long Thanh international airport (future)":"25 min"}'::jsonb
  ),
  (
    'vinhomes-golden-river',
    'Vinhomes Golden River sits on the most coveted slice of D1 riverside, the former Ba Son shipyard. Aqua 1–4 and the Landmark towers deliver hotel-grade arrivals, private marina access, and a curved riverfront promenade walking distance to Ben Thanh and the upcoming metro. The crowd is senior finance, diplomats, and HNW Vietnamese families.',
    ARRAY['Private marina & riverfront promenade','Sky pool with river view','Vincom Center Landmark 81 access','Concierge & valet','Premium gym & spa','Sky bar (Landmark)','Pet-friendly walking paths','24/7 security'],
    ARRAY['Only true riverfront luxury complex in D1','Walking distance to Ben Thanh & metro','Strong long-term capital values','Cleanest, quietest D1 location'],
    ARRAY['Top-tier pricing','Limited 1BR inventory','Aqua 4 lower floors face other towers'],
    '{"Ben Thanh Market":"8 min walk","Notre Dame Cathedral":"10 min walk","Tan Son Nhat airport":"20–25 min","Thao Dien":"15 min"}'::jsonb
  )
)
UPDATE public.complexes c
SET description = COALESCE(data.descr, c.description),
    amenities  = CASE WHEN COALESCE(array_length(c.amenities,1),0) = 0 THEN data.amen ELSE c.amenities END,
    insider_pros = CASE WHEN COALESCE(array_length(c.insider_pros,1),0) = 0 THEN data.pros ELSE c.insider_pros END,
    insider_cons = CASE WHEN COALESCE(array_length(c.insider_cons,1),0) = 0 THEN data.cons ELSE c.insider_cons END,
    commute_times = COALESCE(c.commute_times, data.commute),
    updated_at = now()
FROM data WHERE c.slug = data.slug;
