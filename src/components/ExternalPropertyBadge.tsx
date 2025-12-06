import { ExternalLink, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';

interface ExternalPropertyBadgeProps {
  source: string;
  sourceUrl?: string;
  className?: string;
  cached?: boolean;
  crawledAt?: string;
}

// Helper to format time ago
const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  return 'Just now';
};

export const ExternalPropertyBadge = ({ source, sourceUrl, className = '', cached, crawledAt }: ExternalPropertyBadgeProps) => {
  const sourceInfo = getPropertySourceLogo(sourceUrl || source);
  
  const handleClick = (e: React.MouseEvent) => {
    if (sourceUrl) {
      e.stopPropagation();
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <Badge 
        variant="secondary" 
        className="flex items-center gap-1.5 cursor-pointer hover:bg-secondary/80 transition-colors"
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
      {cached && crawledAt && (
        <Badge variant="outline" className="text-[10px] py-0 px-1.5 flex items-center gap-1 bg-background/80">
          <Clock className="w-2.5 h-2.5" />
          {formatTimeAgo(crawledAt)}
        </Badge>
      )}
    </div>
  );
};
