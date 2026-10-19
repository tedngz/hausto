import { getNormalizedAmenities } from '@/lib/amenities';

interface PropertyAmenitiesProps {
  amenities: string[];
  compact?: boolean;
  /** 'overlay' renders translucent chips for use on top of a dark photo */
  variant?: 'default' | 'overlay';
}

export const PropertyAmenities = ({ amenities, compact = true, variant = 'default' }: PropertyAmenitiesProps) => {
  if (!amenities || amenities.length === 0) return null;

  const uniqueAmenities = getNormalizedAmenities(amenities, compact ? 8 : 12);

  if (uniqueAmenities.length === 0) return null;

  const chipClass =
    variant === 'overlay'
      ? 'bg-white/15 border-white/25 text-white backdrop-blur-md'
      : 'bg-muted/50 border-border text-muted-foreground';

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'py-2' : 'py-3'}`}>
      {uniqueAmenities.map(({ key, label, icon: Icon }) => {
        if (Icon) {
          return (
            <div
              key={key}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${chipClass} ${compact ? 'text-xs' : 'text-sm'}`}
              title={label}
            >
              <Icon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              <span className="font-medium">{label}</span>
            </div>
          );
        }

        // Render AI-detected amenities without icons
        return (
          <div
            key={key}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${chipClass} ${compact ? 'text-xs' : 'text-sm'}`}
            title={label}
          >
            <span className="font-medium">{label}</span>
          </div>
        );
      })}
    </div>
  );
};
