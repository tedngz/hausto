import { Button } from "@/components/ui/button";
import { HaustoLogo } from "@/components/HaustoLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Home, ShieldCheck, BadgeCheck, Users, Sparkles, ArrowRight, Building2, MessageSquare, LogOut } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { HomeAI } from "@/components/HomeAI";
import { useAuth } from "@/hooks/useAuth";
import AnimatedBackground from "@/components/AnimatedBackground";
import { useComplexes } from "@/hooks/useComplexes";
import { ComplexCard } from "@/components/ComplexCard";
import { LiveListingsPreview } from "@/components/LiveListingsPreview";

export const LandingPage = () => {
  const navigate = useNavigate();
  const {
    user,
    signOut
  } = useAuth();
  const { data: complexes } = useComplexes();
  const notableComplexes = (complexes ?? []).slice(0, 6);
  const handleSignOut = async () => {
    await signOut();
    // Force reload to reset any app state
    window.location.reload();
  };
  const handleGetStarted = () => {
    navigate('/auth');
  };
  const handleDiscover = () => {
    if (user) {
      navigate('/hub');
    } else {
      navigate('/auth', {
        state: {
          returnTo: '/hub'
        }
      });
    }
  };
  return <div className="min-h-screen relative">
      <AnimatedBackground />
      {/* Header */}
      <header className="container mx-auto px-4 py-4 md:py-6">
        <nav className="flex items-center justify-between">
          <HaustoLogo />
          <div className="flex items-center gap-2 md:gap-4">
            {user ? <>
                <span className="hidden sm:block text-xs md:text-sm text-muted-foreground truncate max-w-32 md:max-w-none">
                  Welcome back, {user.user_metadata?.name || user.email?.split('@')[0]}!
                </span>
                <Button onClick={handleDiscover} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                  Discover
                </Button>
                <Button onClick={handleSignOut} variant="ghost" size="sm" aria-label="Sign out" className="text-muted-foreground hover:text-foreground p-2 md:px-3">
                  <LogOut className="h-4 w-4 md:mr-2" aria-hidden="true" />
                  <span className="hidden md:inline">Sign Out</span>
                </Button>
              </> : <Button onClick={() => navigate('/auth')} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground text-xs md:text-sm px-3 md:px-4">
                Sign In
              </Button>}
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main>
      <section className="container mx-auto px-4 py-8 md:py-12">
        <div className="text-center max-w-4xl mx-auto w-full">
          {/* The hero owns the first screen. It is centred in what is left of
              the viewport once the header, the section padding and the next
              heading are taken off, so only "Your curated rental hub" shows
              under it until the renter scrolls. The offsets are those heights:
              header 68/84px, padding 32/48px, the preview's mt-12, its heading
              36/40px, and 12px below it - the heading's own mt-3 gap to the
              subtitle, so the subtitle starts at the fold. svh, so a phone's
              address bar cannot push the heading out of sight. A taller hero
              (a phone, a signed-in renter's chat controls) just grows past it. */}
          <div className="flex min-h-[calc(100svh-12.25rem)] flex-col justify-center md:min-h-[calc(100svh-14.5rem)]">
            {/* The headline is the hook and matches the search box below; the
                one line under it is what Hausto is for. Keep it one line. */}
            <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight text-foreground mb-4 md:mb-5">
              <span className="text-primary">Vibe check</span>
              <span className="block">your next home</span>
            </h1>
            <p className="mx-auto mb-6 max-w-2xl text-lg text-muted-foreground md:mb-8 md:text-xl">
              Let our AI deal with the agents - you just show up.
            </p>

            <div className="mb-4">
              {/* The hero chat takes the question and hands it to the hub, which
                  answers it - results need the width and the tabs beside them. */}
              <HomeAI handoffToHub />
            </div>
          </div>

          {/* The verified-listings table is the center of the platform: it gets
              the first content slot, rendered as a live preview of /browse. */}
          <LiveListingsPreview />

          {/* Secondary discovery: complexes keep their cards but not a
              hero-level CTA - the section header link is enough. */}
          {notableComplexes.length > 0 && (
            <div className="mt-12 text-left">
              <div className="mb-6 text-center">
                <h2 className="font-serif text-3xl md:text-4xl tracking-tight">Vetted homes renters love</h2>
                <Link
                  to="/hub"
                  className="inline-block mt-2 text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline transition-colors"
                >
                  Explore all vetted complexes →
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {notableComplexes.map((c) => <ComplexCard key={c.id} complex={c} />)}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h2 className="text-foreground mb-4 font-serif text-4xl font-normal">Renting without the back-and-forth</h2>
        </div>

        {/* What the viewing service saves a renter: chasing agents, agents
            chasing them, and turning up for a place that was never there.
            The bait check is the agent's own answer - "already rented" and
            "different price" are outcomes an operator records (SPEC §4). */}
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors pulse-ring-wrapper">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-serif font-normal">No agent chasing</h3>
              <p className="text-muted-foreground leading-relaxed [text-wrap:balance]">We set up every viewing and send you one plan.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <ShieldCheck className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-normal font-serif">Your number stays private</h3>
              <p className="text-muted-foreground leading-relaxed [text-wrap:balance]">Agents never get it from us, so no follow-up spam.</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border hover:shadow-xl transition-all duration-300 group">
            <CardContent className="p-8 text-center">
              <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-6 group-hover:bg-primary/20 transition-colors">
                <BadgeCheck className="h-8 w-8 text-primary animate-gentle-bob" />
              </div>
              <h3 className="text-2xl text-foreground mb-4 font-serif font-normal">No bait listings</h3>
              <p className="text-muted-foreground leading-relaxed [text-wrap:balance]">We check it's still free at the listed price before you go.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Realtor CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-card border border-border rounded-2xl p-12">
            <Building2 className="h-16 w-16 text-primary mx-auto mb-6" />
            <h2 className="text-foreground mb-6 text-3xl font-normal font-serif">
              List your properties on Hausto
            </h2>
            <div className="flex justify-center">
              <Button onClick={() => navigate('/realtor/apply')} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-12 py-6 text-lg font-semibold w-full sm:w-auto">
                Apply as a realtor
                <ArrowRight className="ml-2 h-6 w-6" />
              </Button>
            </div>
          </div>
        </div>
      </section>
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-8">
        <div className="container mx-auto px-4">
          <HaustoLogo size="sm" className="justify-center" />
          <p className="text-center text-muted-foreground mt-2">© 2025 Hausto. All rights reserved.</p>
          <p className="text-center text-muted-foreground mt-1">
            <a href="mailto:hello@hausto.com" className="hover:text-foreground transition-colors">hello@hausto.com</a>
          </p>
          <p className="text-center text-muted-foreground mt-1">
            <Link to="/privacy" className="hover:text-foreground transition-colors underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            {' · '}
            <Link to="/terms" className="hover:text-foreground transition-colors underline-offset-4 hover:underline">
              Refund policy
            </Link>
          </p>
        </div>
      </footer>
    </div>;
};