import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CITY_LABEL } from '@/hooks/useComplexes';

interface Props {
  city: string | null;
  setCity: (v: string | null) => void;
  district: string | null;
  setDistrict: (v: string | null) => void;
  tag: string | null;
  setTag: (v: string | null) => void;
  districts: string[];
  tags: string[];
}

export function ComplexFilters({ city, setCity, district, setDistrict, tag, setTag, districts, tags }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={city === null ? 'default' : 'outline'} onClick={() => { setCity(null); setDistrict(null); }}>
          All cities
        </Button>
        {Object.entries(CITY_LABEL).map(([k, v]) => (
          <Button key={k} size="sm" variant={city === k ? 'default' : 'outline'} onClick={() => { setCity(k); setDistrict(null); }}>
            {v}
          </Button>
        ))}
      </div>

      {districts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setDistrict(null)}
            className={`text-xs px-3 py-1 rounded-full border transition ${district === null ? 'bg-foreground text-background border-foreground' : 'border-border hover:border-foreground/40'}`}
          >
            All districts
          </button>
          {districts.map((d) => (
            <button
              key={d}
              onClick={() => setDistrict(d)}
              className={`text-xs px-3 py-1 rounded-full border transition ${district === d ? 'bg-foreground text-background border-foreground' : 'border-border hover:border-foreground/40'}`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge
              key={t}
              variant={tag === t ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
