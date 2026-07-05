// Collapse crawler artifacts like "Cozy 2BR in Thao Dien Cozy 2BR in Thao Dien"
// or "Title | Title" into a single clean title.
export const normalizeRepeatedTitle = (title: string) => {
  const clean = title.replace(/\s+/g, ' ').trim();
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ');

  for (let size = Math.floor(tokens.length / 2); size >= 2; size -= 1) {
    for (let i = 0; i + size * 2 <= tokens.length; i += 1) {
      const first = normalize(tokens.slice(i, i + size).join(' '));
      const second = normalize(tokens.slice(i + size, i + size * 2).join(' '));
      if (first && first === second) {
        return [...tokens.slice(0, i + size), ...tokens.slice(i + size * 2)].join(' ');
      }
    }
  }

  const parts = clean.split(/\s+([|•·]|-{2,}|–|—)\s+/);
  const seen = new Set<string>();
  return parts.reduce<string[]>((acc, part) => {
    const key = normalize(part);
    if (key && !/^[|•·–—-]+$/.test(part)) {
      if (seen.has(key)) return acc;
      seen.add(key);
    }
    acc.push(part);
    return acc;
  }, []).join(' ').replace(/\s+([|•·–—-])\s*$/g, '').trim();
};
