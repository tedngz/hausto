-- Photos from agents, through the Zalo bridge (PLAN-v3 S7.2b, SPEC §11).
--
-- An agent answering "what is free at Empire City?" sends pictures more often
-- than words. The device now forwards photo messages from watched agents;
-- for an availability request, zalo-bridge copies each into our storage
-- under concierge/<request>/ - the path a captured unit's photos must use -
-- and the reply row lists them here, so the operator can put them on the unit
-- without asking the agent again.
--
-- [{ "url": "<public storage url>" }, ...]. Additive and replay-safe.

ALTER TABLE public.realtor_messages ADD COLUMN IF NOT EXISTS attachments jsonb;
