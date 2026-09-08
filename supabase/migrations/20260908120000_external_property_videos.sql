-- Source listings carry walkthrough videos alongside their photo galleries
-- (nhatot serves them as Cloudflare Stream HLS manifests). The crawler now
-- captures them; they are referenced on the source CDN rather than mirrored.
alter table public.external_properties
  add column if not exists videos jsonb not null default '[]'::jsonb;

comment on column public.external_properties.videos is
  'Videos from the source listing: [{url, thumbnail, source}]. Not mirrored.';

-- SELECT on this table is granted column by column (contact_phone and
-- raw_data are deliberately withheld from anon), so a new column is invisible
-- to the app until it is named here.
grant select (videos) on public.external_properties to anon, authenticated;
