
-- 1. Delete complexes that are neither notable curated nor have listings
DELETE FROM public.complexes
WHERE slug NOT IN (
  -- curated originals
  'the-metropole-thu-thiem','the-marq-d1','masteri-an-phu-d2','city-garden-binh-thanh',
  'the-elysian-tay-ho','lotte-center-residences-ba-dinh',
  -- with listings
  'vinhomes-central-park','vinhomes-grand-park','vinhomes-golden-river','hado-centrosa-garden',
  'sky-garden','saigon-royal','masteri-thao-dien','celadon-city','the-manor','charmington-la-pointe',
  'millennium','empire-city','lumiere-riverside','the-tresor','scenic-valley','garden-gate',
  'the-sun-avenue','pearl-plaza'
);

-- 2. Enrich kept rows with English district, developer, management, hero image, and rent brackets
WITH data(slug, district_en, developer, mgmt, hero, brackets) AS (
  VALUES
  ('vinhomes-central-park','Binh Thanh','Vingroup','Vinhomes',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1200&q=80',
    '{"1br":{"min":700,"max":1000},"2br":{"min":1100,"max":1700},"3br":{"min":1800,"max":3000}}'::jsonb),
  ('vinhomes-grand-park','Thu Duc','Vingroup','Vinhomes',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    '{"1br":{"min":400,"max":600},"2br":{"min":600,"max":900},"3br":{"min":900,"max":1400}}'::jsonb),
  ('vinhomes-golden-river','District 1','Vingroup','Vinhomes',
    'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200&q=80',
    '{"1br":{"min":1200,"max":1700},"2br":{"min":2000,"max":3200},"3br":{"min":3500,"max":6000}}'::jsonb),
  ('hado-centrosa-garden','District 10','Ha Do Group','Savills',
    'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200&q=80',
    '{"1br":{"min":600,"max":900},"2br":{"min":900,"max":1400},"3br":{"min":1500,"max":2200}}'::jsonb),
  ('sky-garden','District 7','Phu My Hung Corp','Phu My Hung',
    'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80',
    '{"1br":{"min":500,"max":800},"2br":{"min":800,"max":1200},"3br":{"min":1200,"max":1800}}'::jsonb),
  ('saigon-royal','District 4','Novaland','Savills',
    'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=1200&q=80',
    '{"1br":{"min":800,"max":1200},"2br":{"min":1300,"max":2000},"3br":{"min":2200,"max":3500}}'::jsonb),
  ('masteri-thao-dien','Thu Duc','Thao Dien Investment','CBRE',
    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80',
    '{"1br":{"min":700,"max":1000},"2br":{"min":1100,"max":1700},"3br":{"min":1800,"max":2800}}'::jsonb),
  ('celadon-city','Tan Phu','Gamuda Land','Savills',
    'https://images.unsplash.com/photo-1494526585095-c41746248156?w=1200&q=80',
    '{"1br":{"min":400,"max":600},"2br":{"min":600,"max":900},"3br":{"min":1000,"max":1400}}'::jsonb),
  ('the-manor','Binh Thanh','Bitexco Group','Savills',
    'https://images.unsplash.com/photo-1496564203457-11bb12075d90?w=1200&q=80',
    '{"1br":{"min":700,"max":1000},"2br":{"min":1100,"max":1600},"3br":{"min":1700,"max":2500}}'::jsonb),
  ('charmington-la-pointe','District 10','TTC Land','CBRE',
    'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
    '{"1br":{"min":500,"max":700},"2br":{"min":800,"max":1200},"3br":{"min":1300,"max":1800}}'::jsonb),
  ('millennium','District 4','Masterise Homes','CBRE',
    'https://images.unsplash.com/photo-1515263487990-61b07816b324?w=1200&q=80',
    '{"1br":{"min":800,"max":1200},"2br":{"min":1300,"max":2000},"3br":{"min":2200,"max":3500}}'::jsonb),
  ('empire-city','Thu Duc','Keppel Land & Tien Phuoc & Tran Thai & Gaw Capital','Savills',
    'https://images.unsplash.com/photo-1542317854-6c97d61c0e23?w=1200&q=80',
    '{"1br":{"min":1200,"max":1800},"2br":{"min":2000,"max":3200},"3br":{"min":3500,"max":6000}}'::jsonb),
  ('lumiere-riverside','Thu Duc','Masterise Homes','CBRE',
    'https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=1200&q=80',
    '{"1br":{"min":900,"max":1300},"2br":{"min":1400,"max":2200},"3br":{"min":2500,"max":4000}}'::jsonb),
  ('the-tresor','District 4','Novaland','Savills',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    '{"1br":{"min":800,"max":1200},"2br":{"min":1300,"max":2000},"3br":{"min":2200,"max":3500}}'::jsonb),
  ('scenic-valley','District 7','Phu My Hung Corp','Phu My Hung',
    'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200&q=80',
    '{"1br":{"min":700,"max":1000},"2br":{"min":1100,"max":1700},"3br":{"min":1800,"max":2800}}'::jsonb),
  ('garden-gate','Phu Nhuan','Novaland','CBRE',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    '{"1br":{"min":600,"max":900},"2br":{"min":900,"max":1400},"3br":{"min":1500,"max":2200}}'::jsonb),
  ('the-sun-avenue','Thu Duc','Novaland','Savills',
    'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=1200&q=80',
    '{"1br":{"min":500,"max":800},"2br":{"min":800,"max":1200},"3br":{"min":1300,"max":2000}}'::jsonb),
  ('pearl-plaza','Binh Thanh','SSG Group','Savills',
    'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200&q=80',
    '{"1br":{"min":800,"max":1200},"2br":{"min":1300,"max":2000},"3br":{"min":2200,"max":3500}}'::jsonb)
)
UPDATE public.complexes c
SET district = d.district_en,
    developer = COALESCE(c.developer, d.developer),
    management_company = COALESCE(c.management_company, d.mgmt),
    hero_image = COALESCE(c.hero_image, d.hero),
    average_rent_brackets = CASE
      WHEN c.average_rent_brackets IS NULL OR c.average_rent_brackets = '{}'::jsonb
      THEN d.brackets ELSE c.average_rent_brackets END,
    updated_at = now()
FROM data d
WHERE c.slug = d.slug;

-- 3. Translate Vietnamese district names on remaining curated rows too
UPDATE public.complexes SET district = 'Thu Duc' WHERE district IN ('Thủ Đức','Thu Thiem');
UPDATE public.complexes SET district = 'Binh Thanh' WHERE district = 'Bình Thạnh';
UPDATE public.complexes SET district = 'Phu Nhuan' WHERE district = 'Phú Nhuận';
UPDATE public.complexes SET district = 'Tan Binh' WHERE district = 'Tân Bình';
UPDATE public.complexes SET district = 'Tan Phu' WHERE district = 'Tân Phú';
UPDATE public.complexes SET district = 'Go Vap' WHERE district = 'Gò Vấp';
