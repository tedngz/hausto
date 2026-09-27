-- AI operator plan, stage 3: the Zalo bridge on an always-on device.
--
-- The owner chose on 2026-09-27 to reach agents through a small daemon that
-- stays logged in to the business's Zalo account (bridge/README.md). It
-- automates a personal account, which Zalo's terms do not allow; that risk
-- was accepted knowingly. What this migration adds is the Hausto half: the
-- outbox the device sends from, the bookkeeping that makes each send happen
-- once, and the device's heartbeat.

-- ── the outbox ──────────────────────────────────────────────────────────────
-- A message for the bridge is a realtor_messages row left QUEUED by the
-- channel (_shared/realtor/channel.ts, BridgeChannel). The device claims it,
-- sends it, and acks it.
ALTER TABLE public.realtor_messages
  -- Set when the device takes the row, so two pulls cannot both send it. A
  -- claim older than the lease is taken again - the device's own journal is
  -- what stops a crash between send and ack from sending twice.
  ADD COLUMN IF NOT EXISTS claimed_at    timestamptz,
  -- The event the send stands for (REALTOR_CONTACTED, ITEM_NUDGED,
  -- REALTOR_NOTIFIED), written when the device reports SENT - not when an
  -- operator pressed a button. "Contacted" means the agent was sent something.
  ADD COLUMN IF NOT EXISTS on_sent_event jsonb;

CREATE INDEX IF NOT EXISTS realtor_messages_outbox_idx
  ON public.realtor_messages (created_at)
  WHERE direction = 'OUT' AND status = 'QUEUED';

-- ── the device ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zalo_bridge_status (
  id           text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  last_seen_at timestamptz,
  device       text,
  version      text,
  sent_today   integer NOT NULL DEFAULT 0,
  last_error   text,
  -- Any operator can stop the device sending without touching it. It keeps
  -- reading replies; only sending stops.
  paused       boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.zalo_bridge_status (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.zalo_bridge_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ops read zalo_bridge_status" ON public.zalo_bridge_status;
CREATE POLICY "Ops read zalo_bridge_status" ON public.zalo_bridge_status
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read zalo_bridge_status" ON public.zalo_bridge_status;
CREATE POLICY "Admins read zalo_bridge_status" ON public.zalo_bridge_status
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.zalo_bridge_status IS
  'The always-on Zalo bridge device: heartbeat, send count, and the operator pause on its sending. Written by zalo-bridge and ops-record-outcome.';
