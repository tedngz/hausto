# Realtor Onboarding & Approval Flow

## 1. Repurpose the landing CTA section
File: `src/components/LandingPage.tsx` (the "Ready to find your dream home?" card).

Rewrite into a realtor-recruitment block:
- Heading: "List your properties on Hausto"
- Sub: "Vetted brokers and owners only. Apply to access our renter network and dashboard."
- Button: "Apply as a realtor →" → navigates to `/realtor/apply`
- Icon: keep building icon (already fits)

Renter conversion is already handled by the hero/HomeAI above, so the duplicate renter CTA is removed.

## 2. Database (new migration)

Extend `app_role` enum with `realtor`:
```sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'realtor';
```

New table `public.realtor_applications`:
- `id uuid pk`
- `user_id uuid references auth.users(id) on delete cascade` (unique)
- `full_name text`, `company text`, `phone text`, `email text`
- `role_type text check in ('agent','owner','agency')`
- `city text`, `districts text[]`
- `years_experience int`
- `properties_count int`
- `website_or_listing_url text`
- `bio text`
- `status text default 'pending' check in ('pending','approved','rejected')`
- `admin_notes text`
- `reviewed_by uuid`, `reviewed_at timestamptz`
- `created_at`, `updated_at`

GRANTs + RLS:
- `authenticated`: insert own row, select own row, update own row only while `status = 'pending'`
- Admins (via `has_role(auth.uid(),'admin')`): select/update all
- `service_role`: all

Trigger on UPDATE: when `status` transitions to `'approved'`, insert `(user_id,'realtor')` into `public.user_roles` (ON CONFLICT DO NOTHING) and stamp `reviewed_at`.

## 3. New realtor application page
`src/pages/RealtorApply.tsx` + route `/realtor/apply` in `App.tsx`.

- Requires auth; if logged-out, redirect to `/auth` with returnTo.
- If the user already has an application, show its status (Pending / Approved / Rejected with notes) instead of the form.
- If approved, show a "Go to dashboard" button → `/discover` (with `userType=realtor` set).
- Validates inputs with zod, submits insert into `realtor_applications`.

## 4. Gate realtor access everywhere
Create `src/hooks/useUserRoles.tsx` that loads the current user's roles from `user_roles`.

- `src/components/UserTypeSelector.tsx`: only show the "I'm a Realtor" card when `roles.includes('realtor')`. Otherwise replace with a small "Are you a realtor? Apply here" link to `/realtor/apply`.
- `src/pages/Discover.tsx` `handleUserTypeSelect` / `switchUserType`: block switching to `realtor` unless the role exists; if not, route to `/realtor/apply`.
- On initial load, if localStorage says `realtor` but role is missing, force back to `renter`.
- `RealtorNavigation` "Switch to Renter" stays; renter `UserMenu` "Switch to Realtor" item is hidden unless approved.

## 5. Admin review UI
Extend `src/pages/AdminTools.tsx` with a "Realtor Applications" panel (admin-gated via `has_role`):
- Table of pending applications with all submitted fields
- Approve / Reject buttons → update `status` (+ optional `admin_notes`)
- Filter tabs: Pending / Approved / Rejected
- Approval relies on the DB trigger to grant the role; UI just updates status.

## 6. Out of scope
- No email notifications on approval (can be added later via edge function).
- No edit/resubmit flow for rejected applications in v1 — applicant sees rejection + notes only.
- No realtor-specific public profile changes.

## Technical notes
- One migration handles the enum addition, table, grants, RLS, and the approval trigger.
- The enum `ALTER TYPE ... ADD VALUE` must be committed before the trigger references `'realtor'`; split into two migration files if Postgres complains.
- Frontend reads roles via a single `useUserRoles` hook cached with react-query so gating is consistent across pages.
