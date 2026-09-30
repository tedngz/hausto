// The Vietnamese messages the operator sends a broker.
//
// Templated rather than generated. An LLM draft is on the roadmap (PLAN-v3
// lists it as automatable today), but the first two hundred of these are how we
// find out what a good one says - and a template the operator edits before
// sending produces exactly the corpus that training a generator needs, at zero
// latency and zero cost per request. What they actually sent is stored in
// `realtor_messages`, so the edits are the signal.
//
// Shared rather than console-only because the server builds the same drafts
// once the AI operator writes them, and two copies of what we say to a broker
// is how the two start saying different things.
//
// None of them mentions the renter. The broker learns a price, a listing and
// some times; who is asking is not theirs to know (invariant 4). send.ts checks
// the edited text again on the way out.

const PART_VI: Record<string, string> = {
  MORNING: 'buổi sáng',
  AFTERNOON: 'buổi chiều',
  EVENING: 'buổi tối',
};

/** `15.000.000 ₫` - the Vietnamese grouping is what a broker reads without pausing. */
function vnd(dong: number): string {
  return `${Math.round(dong).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/** `12/09` - day first, as written locally. */
function dayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

/** `10:30 ngày 12/09`, in Asia/Ho_Chi_Minh - a slot is stored UTC. */
function slotVi(startsAt: string): string {
  const local = new Date(Date.parse(startsAt) + 7 * 60 * 60 * 1000).toISOString();
  return `${local.slice(11, 16)} ngày ${local.slice(8, 10)}/${local.slice(5, 7)}`;
}

/** First contact about one unit. */
export function draftForRealtor(opts: {
  listingTitle: string;
  listingUrl: string | null;
  priceVnd: number;
  availability: { date: string; part: string }[];
}): string {
  const windows = opts.availability
    .map(w => `${dayMonth(w.date)} ${PART_VI[w.part] ?? w.part.toLowerCase()}`)
    .join(', ');

  return [
    'Chào anh/chị,',
    '',
    `Bên em có khách muốn xem căn: ${opts.listingTitle}` +
      (opts.listingUrl ? ` (${opts.listingUrl})` : ''),
    `Giá đang đăng: ${vnd(opts.priceVnd)}/tháng.`,
    '',
    windows
      ? `Khách rảnh ${windows}. Anh/chị sắp xếp được khung nào ạ?`
      : 'Anh/chị sắp xếp được khung giờ nào trong tuần này ạ?',
    '',
    // The two questions worth asking every time, because they are the two that
    // waste a trip: the unit is gone, or the price moved.
    'Căn còn trống và giá còn đúng như trên không ạ?',
    '',
    'Em cảm ơn anh/chị.',
  ].join('\n');
}

/**
 * Asking a building's agent what is free, for an availability request (PLAN-v3
 * S7.2). The brief, and the three things that let an offer be made without a
 * second round: photos, the price, and when it can be seen. Nothing about who
 * is asking - the brief is a flat, not a person.
 */
export function availabilityDraft(opts: {
  complexName: string;
  bedrooms: number;
  budgetMaxVnd: number | null;
  moveInDate: string;
  leaseMonths: number;
  hasPets: boolean;
}): string {
  const beds = opts.bedrooms >= 4 ? 'từ 4 phòng ngủ' : `${opts.bedrooms} phòng ngủ`;
  return [
    'Chào anh/chị,',
    '',
    `Em bên Hausto, đang tìm căn ở ${opts.complexName} cho khách:`,
    `- ${beds}${opts.budgetMaxVnd ? `, tối đa ${vnd(opts.budgetMaxVnd)}/tháng` : ''}`,
    `- vào ở khoảng ${dayMonth(opts.moveInDate)}, thuê ${opts.leaseMonths} tháng`,
    opts.hasPets ? '- khách có nuôi thú cưng' : '- không nuôi thú cưng',
    '',
    'Anh/chị có căn nào đang trống phù hợp không ạ? Nếu có, anh/chị gửi em giúp hình, giá và khi nào xem được nhé.',
    '',
    'Em cảm ơn anh/chị.',
  ].join('\n');
}

/**
 * Chasing a broker who has not answered. Short, and it repeats the listing -
 * a broker with forty chats open has lost the first message by now.
 */
export function nudgeDraft(opts: { listingTitle: string }): string {
  return [
    'Chào anh/chị,',
    '',
    `Em nhắn lại về căn ${opts.listingTitle}. Khách bên em vẫn đang chờ lịch xem ạ.`,
    'Anh/chị báo giúp em căn còn trống không và xem được giờ nào nhé.',
    '',
    'Em cảm ơn anh/chị.',
  ].join('\n');
}

/**
 * The renter kept this viewing. Names the time back to the broker, because a
 * confirmation that does not say when is one they have to ask about.
 *
 * It also asks the two things the viewing-day message needs (viewing-day.ts):
 * where to meet, and whether their number may go to the renter that morning.
 * Asked, never assumed - the operator records the answer as VIEWING_DETAILS.
 */
export function confirmDraft(opts: { listingTitle: string; startsAt: string | null }): string {
  return [
    'Chào anh/chị,',
    '',
    opts.startsAt
      ? `Khách đã chốt lịch xem căn ${opts.listingTitle} lúc ${slotVi(opts.startsAt)}.`
      : `Khách đã chốt lịch xem căn ${opts.listingTitle}.`,
    'Anh/chị giữ lịch giúp em nhé. Nếu có thay đổi em sẽ báo lại ngay.',
    '',
    'Anh/chị cho em xin chỗ hẹn gặp khách (toà nào, sảnh nào) nhé.',
    'Sáng hôm xem em gửi số điện thoại của anh/chị cho khách để khách gọi khi cần - anh/chị có đồng ý không ạ?',
    '',
    'Em cảm ơn anh/chị.',
  ].join('\n');
}

/**
 * The renter is not coming. Said plainly and without a reason: the broker
 * needs to stop holding the time, not an explanation, and the reason is the
 * renter's business.
 */
export function releaseDraft(opts: { listingTitle: string }): string {
  return [
    'Chào anh/chị,',
    '',
    `Khách bên em không xem căn ${opts.listingTitle} nữa ạ, anh/chị không cần giữ lịch.`,
    'Cảm ơn anh/chị đã hỗ trợ, có khách phù hợp em sẽ liên hệ lại.',
  ].join('\n');
}
