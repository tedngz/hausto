// The Vietnamese message the operator sends the broker.
//
// Templated rather than generated. An LLM draft is on the roadmap (PLAN-v3
// lists it as automatable today), but the first two hundred of these are how we
// find out what a good one says - and a template the operator edits before
// sending produces exactly the corpus that training a generator needs, at zero
// latency and zero cost per request.
//
// It never mentions the renter. The broker learns a price, a listing and some
// windows; who is asking is not theirs to know (invariant 4).

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
