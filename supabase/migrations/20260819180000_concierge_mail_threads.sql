-- Mail to hello@hausto.com that matches no availability request had nowhere to
-- live, so its notification could only offer Reply-To: the sender - which sends
-- the admin's personal address straight out and drops the conversation.
-- A thread row gives that mail an alias to be answered through.
create table if not exists public.concierge_mail_threads (
  id uuid primary key default gen_random_uuid(),
  contact_email text not null,
  contact_name text,
  subject text,
  subject_key text not null,
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One thread per person per conversation: a reply keeps the subject (modulo
-- "Re:"), a genuinely new topic gets its own thread.
create unique index if not exists concierge_mail_threads_contact_subject_idx
  on public.concierge_mail_threads (lower(contact_email), subject_key);

-- No policies: only the edge functions touch this, and they use the service
-- role, which bypasses RLS. Enabled so nothing is reachable with an anon key.
alter table public.concierge_mail_threads enable row level security;
