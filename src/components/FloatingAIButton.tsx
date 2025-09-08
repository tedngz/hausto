
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';

interface FloatingAIButtonProps {
  onClick: () => void;
}

export const FloatingAIButton = ({ onClick }: FloatingAIButtonProps) => {
  return (
    <Button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 shadow-lg hover:shadow-xl transition-all duration-200"
    >
      <Send className="w-6 h-6 text-white" />
    </Button>
  );
};
