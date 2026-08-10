import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';
interface FloatingAIButtonProps {
  onClick: () => void;
  /** Unresolved renter-question count shown as a badge (realtors) */
  badgeCount?: number;
}
export const FloatingAIButton = ({
  onClick,
  badgeCount = 0,
}: FloatingAIButtonProps) => {
  return <Button onClick={onClick} aria-label="Open AI chat" className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 shadow-lg hover:shadow-xl transition-all duration-200">
      <MessageCircle className="w-6 h-6 text-white" />
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-semibold border-2 border-white">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </Button>;
};