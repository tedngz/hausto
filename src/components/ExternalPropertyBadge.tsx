import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';

interface ExternalPropertyBadgeProps {
  source: string;
  sourceUrl?: string;
  className?: string;
}

export const ExternalPropertyBadge = ({ source, sourceUrl, className = '' }: ExternalPropertyBadgeProps) => {
  const sourceInfo = getPropertySourceLogo(sourceUrl || source);
  
  const handleClick = (e: React.MouseEvent) => {
    if (sourceUrl) {
      e.stopPropagation();
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Badge 
      variant="secondary" 
      className={`flex items-center gap-1.5 cursor-pointer hover:bg-secondary/80 transition-colors ${className}`}
      onClick={handleClick}
    >
      <img 
        src={sourceInfo.logo} 
        alt={sourceInfo.name}
        className="w-4 h-4 rounded-sm object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <span className="text-xs font-medium">{sourceInfo.name}</span>
      {sourceUrl && <ExternalLink className="w-3 h-3" />}
    </Badge>
  );
};
