// Size values are inconsistent across sources: some already carry a unit
// ("85m²", "120 sqm"), others are a bare number ("64"). Append m² only when
// no unit is present.
export const formatSize = (size?: string | null): string => {
  const s = String(size ?? '').trim();
  if (!s) return '';
  if (/m²|m2|sqm|sq\s*m|ft²|sq\s*ft/i.test(s)) return s;
  return /^\d+([.,]\d+)?$/.test(s) ? `${s}m²` : s;
};
