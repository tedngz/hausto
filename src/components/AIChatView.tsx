import { LandingChatBox } from "@/components/LandingChatBox";

export const AIChatView = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 pt-20">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <LandingChatBox />
        </div>
      </div>
    </div>
  );
};