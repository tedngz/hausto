import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CITY_LABEL } from '@/hooks/useComplexes';

/** Radix has no value for "nothing selected", so the reset option carries one. */
const ANY = 'all';

/**
 * One row of dropdowns, in the shape the browse tab's filter bar already has.
 *
 * It used to be three stacked rows of chips - cities, then every district in
 * the set, then every card highlight - which grew with the data and pushed the
 * grid the renter came for off the bottom of the pane. The chips also read as
 * the content rather than as controls, so the tab opened looking like a wall of
 * tags. Dropdowns hold the same choices in one line, and the list of buildings
 * starts where it should.
 */
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

export function ComplexFilters({
  city,
  setCity,
  district,
  setDistrict,
  tag,
  setTag,
  districts,
  tags,
}: Props) {
  // A blank option value throws in Radix, and both lists come straight from
  // the rows, where a missing district is a real possibility.
  const districtOptions = districts.filter(Boolean);
  const tagOptions = tags.filter(Boolean);
  const hasFilters = !!city || !!district || !!tag;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={city ?? ANY}
        // Districts belong to the city that was showing, so they cannot survive
        // a change of city.
        onValueChange={(v) => { setCity(v === ANY ? null : v); setDistrict(null); }}
      >
        <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All cities</SelectItem>
          {Object.entries(CITY_LABEL).map(([k, v]) => (
            <SelectItem key={k} value={k}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {districtOptions.length > 0 && (
        <Select
          value={district ?? ANY}
          onValueChange={(v) => setDistrict(v === ANY ? null : v)}
        >
          <SelectTrigger className="h-9 w-[160px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All districts</SelectItem>
            {districtOptions.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {tagOptions.length > 0 && (
        <Select value={tag ?? ANY} onValueChange={(v) => setTag(v === ANY ? null : v)}>
          <SelectTrigger className="h-9 w-[170px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All highlights</SelectItem>
            {tagOptions.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => { setCity(null); setDistrict(null); setTag(null); }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}
