
INSERT INTO storage.buckets (id, name, public)
VALUES ('external-property-images', 'external-property-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read external property images" ON storage.objects;
CREATE POLICY "Public read external property images"
ON storage.objects FOR SELECT
USING (bucket_id = 'external-property-images');
