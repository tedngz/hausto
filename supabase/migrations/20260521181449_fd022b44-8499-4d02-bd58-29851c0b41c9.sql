
-- ============ complexes ============
CREATE TABLE public.complexes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL,
  district text NOT NULL,
  developer text,
  management_company text,
  year_completed integer,
  hero_image text,
  gallery text[] DEFAULT '{}'::text[],
  tagline text,
  description text,
  pet_policy text,
  amenities text[] DEFAULT '{}'::text[],
  average_rent_brackets jsonb DEFAULT '{}'::jsonb,
  insider_pros text[] DEFAULT '{}'::text[],
  insider_cons text[] DEFAULT '{}'::text[],
  commute_times jsonb DEFAULT '{}'::jsonb,
  tags text[] DEFAULT '{}'::text[],
  latitude double precision,
  longitude double precision,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.complexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published complexes"
  ON public.complexes FOR SELECT
  USING (is_published = true);

CREATE POLICY "Admins can view all complexes"
  ON public.complexes FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert complexes"
  ON public.complexes FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update complexes"
  ON public.complexes FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete complexes"
  ON public.complexes FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_complexes_updated_at
  BEFORE UPDATE ON public.complexes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_complexes_city ON public.complexes(city);
CREATE INDEX idx_complexes_district ON public.complexes(district);

-- ============ complex_inquiries ============
CREATE TABLE public.complex_inquiries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  complex_id uuid NOT NULL REFERENCES public.complexes(id) ON DELETE CASCADE,
  user_id uuid,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  target_move_in_date date NOT NULL,
  lease_duration_months integer NOT NULL,
  budget_usd_min integer NOT NULL,
  budget_usd_max integer NOT NULL,
  bedrooms_needed integer NOT NULL,
  has_pets boolean NOT NULL DEFAULT false,
  additional_notes text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.complex_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit an inquiry"
  ON public.complex_inquiries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view inquiries"
  ON public.complex_inquiries FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update inquiries"
  ON public.complex_inquiries FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete inquiries"
  ON public.complex_inquiries FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_complex_inquiries_updated_at
  BEFORE UPDATE ON public.complex_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_complex_inquiries_complex ON public.complex_inquiries(complex_id);
CREATE INDEX idx_complex_inquiries_status ON public.complex_inquiries(status);

-- ============ seed data ============
INSERT INTO public.complexes (slug, name, city, district, developer, management_company, year_completed, hero_image, tagline, description, pet_policy, amenities, average_rent_brackets, insider_pros, insider_cons, commute_times, tags, latitude, longitude) VALUES
('the-metropole-thu-thiem', 'The Metropole Thu Thiem', 'ho_chi_minh', 'Thu Thiem', 'SonKim Land', 'Savills', 2022,
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1600&q=80',
  'Riverside luxury moments from District 1',
  'A flagship riverside development in the new financial heart of Saigon, offering panoramic CBD skyline views, hotel-grade finishes, and Savills-managed service standards trusted by senior expat tenants.',
  'Pets allowed up to 15kg. Two-pet maximum, registration required with management.',
  ARRAY['Infinity pool','Sky lounge','Fitness center','24/7 concierge','Co-working lounge','Kids playroom','Spa','BBQ area'],
  '{"1br":{"min":1400,"max":1900},"2br":{"min":2200,"max":3100},"3br":{"min":3400,"max":4800}}'::jsonb,
  ARRAY['Savills management with English-speaking front desk','5 minutes by car to District 1','Brand-new building, low tenant turnover','Hotel-style amenities'],
  ARRAY['Premium pricing vs comparable D2 stock','Limited F&B at the podium (still maturing)','Bridge traffic at peak hours'],
  '{"District 1":"10 min","Tan Son Nhat Airport":"30 min","International Schools":"15 min"}'::jsonb,
  ARRAY['Pet Friendly','Savills Managed','Riverside','New Build'],
  10.7726, 106.7244),

('the-marq-d1', 'The Marq', 'ho_chi_minh', 'District 1', 'HongKong Land & Hoa Lam', 'HongKong Land', 2022,
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1600&q=80',
  'Ultra-luxury in the heart of Saigon',
  'A landmark address on Nguyen Dinh Chieu, walking distance to consulates, premium F&B, and the Saigon River. Managed to international standards with extreme privacy and security.',
  'Pets considered case-by-case. Small dogs and cats accepted with deposit.',
  ARRAY['25m pool','Wellness spa','Wine cellar','Private cinema','Executive lounge','Valet parking','Personal trainers'],
  '{"1br":{"min":2200,"max":2800},"2br":{"min":3500,"max":4800},"3br":{"min":5500,"max":8500}}'::jsonb,
  ARRAY['Walking distance to D1 core','Tier-1 international management','Exceptional sound insulation','Private resident-only club'],
  ARRAY['Steep premium over neighborhood comps','Long waitlists for popular layouts','Strict pet policy'],
  '{"District 1 core":"3 min","Tan Son Nhat Airport":"25 min","Thu Thiem":"15 min"}'::jsonb,
  ARRAY['Concierge','HongKong Land','Walkable','Ultra Luxury'],
  10.7857, 106.6985),

('masteri-an-phu-d2', 'Masteri An Phu', 'ho_chi_minh', 'District 2 (Thao Dien)', 'Masterise Homes', 'CBRE', 2018,
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1600&q=80',
  'The expat favorite in Thao Dien',
  'A mature, well-tenanted complex in the heart of the An Phu / Thao Dien expat corridor. Walkable to international schools, Western F&B, and the An Phu Supermarket strip.',
  'Pet friendly — dogs and cats welcome with no weight limit. Registration required.',
  ARRAY['Two outdoor pools','Tennis court','Fitness center','Kids zone','Riverside promenade','Mini-mart','Co-working'],
  '{"1br":{"min":900,"max":1200},"2br":{"min":1300,"max":1900},"3br":{"min":2200,"max":3000}}'::jsonb,
  ARRAY['Largest expat community in HCMC','Walk to ISHCMC and BIS','CBRE professional management','Excellent F&B in 5-min radius'],
  ARRAY['Building is no longer brand new','Heavy traffic on Nguyen Hoang at rush hour','Pool can be crowded weekends'],
  '{"District 1":"20 min","ISHCMC":"5 min walk","Airport":"35 min"}'::jsonb,
  ARRAY['Pet Friendly','CBRE Managed','Family Friendly','Expat Hub'],
  10.7956, 106.7434),

('city-garden-binh-thanh', 'City Garden', 'ho_chi_minh', 'Binh Thanh', 'Phu Hoang Anh', 'Savills', 2017,
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1600&q=80',
  'Garden-resort living minutes from D1',
  'A tropical low-density estate with mature landscaping, oversized layouts, and resort-style facilities. Popular with families and senior executives seeking quiet within city limits.',
  'Pets allowed with deposit. No size limit. Dog-walking paths on site.',
  ARRAY['Resort pool','Tennis','Gym','Sauna','Lush gardens','Playground','BBQ pavilions'],
  '{"1br":{"min":1100,"max":1500},"2br":{"min":1700,"max":2400},"3br":{"min":2800,"max":4000}}'::jsonb,
  ARRAY['Unusually large unit sizes','Quiet, low-rise feel','Savills concierge','Easy access to D1 via Dien Bien Phu'],
  ARRAY['Older building stock in Phase 1','Limited walkability outside the gate','Some units need refurbishment'],
  '{"District 1":"10 min","Tan Son Nhat":"20 min"}'::jsonb,
  ARRAY['Pet Friendly','Savills Managed','Family Friendly','Resort Style'],
  10.7967, 106.7156),

('the-elysian-tay-ho', 'The Elysian Tay Ho', 'hanoi', 'Tay Ho', 'Capital House', 'Savills', 2021,
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1600&q=80',
  'Lakeside premium in Hanoi''s expat district',
  'A boutique high-rise on West Lake with skyline and lake views, popular with diplomats and senior executives at multinational firms in Tay Ho and Ba Dinh.',
  'Pets welcome. Dog elevator hours reserved 7–9am and 6–8pm.',
  ARRAY['Lake-view pool','Spa','Gym','Library lounge','Concierge','EV charging'],
  '{"1br":{"min":1100,"max":1500},"2br":{"min":1800,"max":2500},"3br":{"min":2800,"max":3800}}'::jsonb,
  ARRAY['Direct West Lake views','Walkable to UNIS Hanoi','Strong diplomatic/expat tenant base','Savills-grade service'],
  ARRAY['Tay Ho traffic into Old Quarter at rush hour','Limited supermarket options on foot'],
  '{"Ba Dinh":"15 min","Noi Bai Airport":"35 min","UNIS Hanoi":"5 min"}'::jsonb,
  ARRAY['Pet Friendly','Savills Managed','Lake View','Diplomat Favorite'],
  21.0631, 105.8221),

('lotte-center-residences-ba-dinh', 'Lotte Center Residences', 'hanoi', 'Ba Dinh', 'Lotte Group', 'Lotte Property', 2014,
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1600&q=80',
  'Serviced living above Hanoi''s skyline',
  'Branded serviced residences atop the Lotte Center tower with direct access to a five-star hotel, department store, and grocery. Premium choice for short-to-medium term corporate relocations.',
  'Small pets only (under 10kg), case-by-case approval.',
  ARRAY['Hotel pool access','Sky lounge','Daily housekeeping option','Grocery in-building','Business center','Spa'],
  '{"1br":{"min":1800,"max":2400},"2br":{"min":2800,"max":3800},"3br":{"min":4200,"max":6000}}'::jsonb,
  ARRAY['Hotel-grade service and security','Grocery and dining inside building','Walking distance to embassies','Reliable English-speaking staff'],
  ARRAY['No outdoor space','Higher service charges','Strict pet policy'],
  '{"Old Quarter":"15 min","Noi Bai Airport":"30 min","Embassy Row":"5 min"}'::jsonb,
  ARRAY['Serviced','Lotte Managed','Corporate','Embassy Adjacent'],
  21.0314, 105.8120);
