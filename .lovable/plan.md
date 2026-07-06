## Goal

Anonymous visitors can:
- Chat with the AI and see matched listings (no phone/name of the property owner).
- Open a shared property link (no phone/name of the property owner).

Anonymous visitors can NOT:
- Read `contact_phone` / `contact_name` on `external_properties`.
- Read `property_source_provider_phone` / `property_source_provider_name` on `properties`.
- Browse Discover, Complexes grid, or any other DB-backed listing page — those require sign-in.

Signed-in users keep full behavior, including contact info in the ContactModal and match views.

## Database changes (single migration)

`external_properties`
- Drop policy `Anyone can view active external properties by direct link`.
- Keep policy `Authenticated users can view active external properties` (already exists).
- `REVOKE SELECT ON public.external_properties FROM anon;`

`properties`
- Drop policy `Anyone can view individual active properties by direct link` (this is the one exposing `property_source_provider_*`).
- Keep the existing authenticated-user SELECT policies.
- `REVOKE SELECT ON public.properties FROM anon;`

Result: anon has zero direct table access to either listings source. Contact columns are unreachable.

## Backend (edge functions, service-role, unaffected by RLS)

`chat-ai` — used by anon and signed-in AI chat
- Detect whether the caller is authenticated (Authorization header present + `getClaims` succeeds).
- When anon: set `providerName: null` and `providerPhone: null` on every scored listing before returning. Everything else (title, images, price, location, match score, share link) stays.
- When signed-in: unchanged.

New edge function `get-public-property` (or extend existing `public-property-search`)
- Input: `{ id }` (internal UUID or external Hausto Agent ID).
- Uses service role to fetch from `properties` then `external_properties`.
- Strips `property_source_provider_name/phone` and `contact_name/phone` from the response for anon callers; returns them for signed-in callers.
- Returns 404 for inactive/expired listings.

## Frontend

`src/pages/PropertyDetail.tsx`
- Replace the two direct `supabase.from('properties'|'external_properties').select(...)` calls with a single call to the new `get-public-property` edge function.
- This keeps shared links working for anon while ensuring contact fields are only present when the viewer is signed in.

`src/hooks/useProperties.tsx` and `src/hooks/useComplexes.tsx` (grid browse)
- Add an auth guard: if there is no session, return `[]` and let the calling pages (Discover, Complexes) render a "Sign in to browse listings" empty state with a login CTA.
- Signed-in behavior unchanged (queries continue to work under the existing authenticated RLS policies).

`src/pages/Discover.tsx` and `src/pages/Complexes.tsx`
- When `useAuth().user` is null, render the sign-in prompt instead of the grid.
- Keep the AI chat entry point visible so anon visitors can still explore via chat.

`src/components/ContactModal.tsx`
- No shape change; it already reads `apartment.property_source_provider_*`. Those fields will simply be absent for anon (via the edge function), so the modal already falls back to the Hausto-managed flow. No user-visible regression for signed-in flows.

## Out of scope

- No changes to `complex_inquiries`, storage bucket policies, `SECURITY DEFINER` function findings, leaked-password protection, or Postgres upgrade — those are separate findings the user did not ask to fix.
- No schema changes to columns themselves; visibility is enforced via RLS + edge function projection.

## Verification

1. Run the app while signed out:
   - Discover / Complexes show a sign-in prompt (no listings grid).
   - AI chat returns listings without `providerName` / `providerPhone`.
   - `/property/:id` share link renders with no contact info.
   - Direct REST call to `external_properties` / `properties` returns permission denied.
2. Sign in and confirm Discover, Complexes, ContactModal, and matches all show contact info exactly as before.
3. Re-run the security scan and mark `external_properties_contact_phone_public` fixed via `manage_security_finding`.
