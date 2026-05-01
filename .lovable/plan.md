
## Recommendation: Inline toast CTA + contextual chat banner

After comparing the options, the lowest-friction pattern is a **two-layer nudge inside the AI chat itself**, never sending the user to a different page or opening a heavy modal upfront:

1. **Layer 1 — Success toast with action button** (immediate, zero-friction)
   The instant a user taps the heart on a property in the AI chat, the existing "Property liked!" toast becomes actionable:

   > ❤️ Property liked! · **[Schedule viewing →]**

   One tap opens the existing `ViewingScheduleModal` pre-filled with that property already selected. This is the fastest path — the user's intent is already at peak right after liking.

2. **Layer 2 — Soft inline banner in the chat thread** (persistent, batchable)
   After the first like, a small dismissible card slides in at the bottom of the AI chat:

   ```text
   ┌──────────────────────────────────────────────┐
   │ 🏠  You've liked 2 properties                │
   │ Want Hausto to coordinate viewings for you?  │
   │             [ Schedule viewings ]   [ ✕ ]    │
   └──────────────────────────────────────────────┘
   ```

   It updates the count as more properties are liked (up to 3 — the fast-track cap) and lets users batch multiple likes into one viewing request, which is the natural Hausto flow. This catches users who dismissed the toast or liked several properties quickly.

### Why not the other options

- **Auto-pop the modal on first like** → feels aggressive, interrupts browsing flow, users often like several before deciding.
- **Separate page / route** → forces context switch, breaks the conversational feel.
- **Only a button on the property card** → invisible until discovered; user has to actively look for it.
- **Wait for AI to suggest it in chat** → too slow, hits LLM unpredictability, easy to miss in a long thread.

The toast+banner combo gives both **instant action** (toast) and **gentle persistence** (banner), with the modal only appearing on explicit user intent.

### Free vs Premium

Fast-track is currently a premium-only feature (HaustoChat gates `get_fast_track` on `subscription_tier === 'premium'`). The same gate applies here:
- **Premium** users: CTA opens `ViewingScheduleModal` directly.
- **Free** users: CTA opens the existing `SubscriptionModal` with copy "Hausto's Fast-Track Viewing is a Premium feature — let Hausto Agent coordinate up to 3 property viewings for you." Same intuitive path; just one extra step before the upgrade decision.

---

## Implementation details (technical)

**File: `src/components/HomeAI.tsx`**
- Add state: `isViewingScheduleOpen`, plus reuse existing `likedProperties: Set<string>`.
- Import `ViewingScheduleModal`, `useSubscription`, `SubscriptionModal`.
- After `createMatch` resolves successfully inside `handleLikeProperty`, fire a Sonner toast with an `action` button:
  ```ts
  sonnerToast.success('Property liked!', {
    action: {
      label: 'Schedule viewing',
      onClick: () => premium ? openScheduleModal([propertyId]) : openSubscriptionModal()
    }
  });
  ```
- Render a sticky `<div>` banner above the chat input when `likedProperties.size >= 1`, with count + dismiss button (state: `isFastTrackBannerDismissed`, resets when a new search starts).
- Build `matchedProperties` prop for `ViewingScheduleModal` by mapping `likedProperties` → entries from `allResults` (id, title, images, location, price). The modal already supports multi-select up to 3.

**File: `src/components/ViewingScheduleModal.tsx`**
- Accept new optional prop `initialSelectedIds?: string[]` and seed `selectedPropertyIds` state with it on open. (One-line change so the toast CTA can pre-select the just-liked property.)

**Submission handler in `HomeAI.tsx`** (mirrors `HaustoChat.handleViewingScheduleSubmit`):
- `INSERT` into `fast_track_requests` with `renter_id = user.id`, `realtor_id = <Hausto Agent ID from src/constants/haustoAgent.ts>` (since AI chat properties may be external or from multiple realtors), `conversation_id = current chat_conversations.id`, `property_ids`, `preferred_dates`, `preferred_times`, `special_requirements`.
- Call existing edge function `notify-fast-track-request` for emails to renter + Hausto.
- Show success toast: "Hausto Agent will reach out shortly to confirm viewings."
- Insert a confirmation `chat_messages` row (role=`assistant`) into the current AI conversation so the receipt lives in the chat history.

**No DB / RLS / edge-function changes required** — `fast_track_requests` table, `notify-fast-track-request` function, and premium gating already exist.

### Edge cases
- Anonymous user likes → existing flow already redirects to `/auth`. No change.
- Already-matched property → toast still shows action; user can still schedule.
- More than 3 liked → banner caps display at "3+ properties · pick which to schedule"; modal enforces the 3-property limit.
- User dismisses banner → stays dismissed for that conversation only; reappears on next AI search/conversation.

### Files touched
- `src/components/HomeAI.tsx` — toast action, banner, modal wiring, submit handler
- `src/components/ViewingScheduleModal.tsx` — `initialSelectedIds` prop (~3 lines)
