import { LandingChatBox } from "@/components/LandingChatBox";

interface AIChatViewProps {
  showNavigation?: boolean;
}

export const AIChatView = ({ showNavigation = true }: AIChatViewProps) => {
  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 ${showNavigation ? 'pt-20' : 'pt-8'}`}>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <LandingChatBox />
        </div>
      </div>
    </div>
  );
};