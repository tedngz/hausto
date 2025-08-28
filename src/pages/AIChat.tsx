import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LandingChatBox } from "@/components/LandingChatBox";
import { useAuth } from "@/hooks/useAuth";
import { CurrencyProvider } from "@/contexts/CurrencyContext";

export const AIChat = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleBack = () => {
    if (user) {
      // Navigate back to the main app if user is logged in
      navigate('/');
    } else {
      // Navigate back to landing page if not logged in
      navigate('/');
    }
  };

  return (
    <CurrencyProvider>
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <nav className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          
          <div className="flex items-center justify-center space-x-2">
            <img 
              src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png" 
              alt="Hausto Logo" 
              className="h-8 w-8"
            />
            <span className="text-2xl font-bold text-foreground">Hausto</span>
          </div>
          
          <div className="w-16"></div> {/* Spacer for center alignment */}
        </nav>
      </header>

      {/* AI Chat Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto mb-12">
          <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6">
            <Sparkles className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 leading-tight">
            AI Property Search
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            Describe your dream home and let our AI find the perfect match for you
          </p>
        </div>
        
        <LandingChatBox />
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-6 text-center">
              <div className="bg-primary/10 p-3 rounded-full w-fit mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Smart Matching</h3>
              <p className="text-muted-foreground text-sm">
                Our AI understands your preferences and finds properties that match your lifestyle
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-6 text-center">
              <div className="bg-primary/10 p-3 rounded-full w-fit mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Natural Language</h3>
              <p className="text-muted-foreground text-sm">
                Describe what you want in plain English - no complex filters needed
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-6 text-center">
              <div className="bg-primary/10 p-3 rounded-full w-fit mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Instant Results</h3>
              <p className="text-muted-foreground text-sm">
                Get personalized property recommendations in seconds
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
    </CurrencyProvider>
  );
};