
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Discover from "./pages/Discover";
import Browse from "./pages/Browse";
import Hub from "./pages/Hub";
import Auth from "./pages/Auth";
import PropertyDetail from "./pages/PropertyDetail";
import NotFound from "./pages/NotFound";
import AdminTools from "./pages/AdminTools";
import AdminComplexes from "./pages/AdminComplexes";
import PassSuccess from "./pages/PassSuccess";
import ComplexDetail from "./pages/ComplexDetail";
import ComplexMap from "./pages/ComplexMap";
import RealtorApply from "./pages/RealtorApply";
import OAuthConsent from "./pages/OAuthConsent";
import { AssistantHandoff } from "@/components/AssistantHandoff";
import { PassGate } from "@/components/PassGate";

// Listing data changes on a crawl cadence measured in hours, not seconds, so
// the stock defaults (staleTime 0 + refetch on every window focus) meant a tab
// switch re-pulled the entire listing set. Anything that genuinely needs to be
// live overrides these per query.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <HelmetProvider>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/hub" element={<Hub />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            {/* Retired: the hub owns the directory now. Kept as a redirect
                so old links and indexed results are not dead ends. */}
            <Route path="/complexes" element={<Navigate to="/hub" replace />} />
            <Route path="/complexes/:slug" element={<ComplexDetail />} />
            <Route path="/map" element={<ComplexMap />} />
            <Route path="/admin-tools" element={<AdminTools />} />
            <Route path="/admin/complexes" element={<AdminComplexes />} />
            <Route path="/realtor/apply" element={<RealtorApply />} />
            <Route path="/pass-success" element={<PassSuccess />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          {/* Carries a card's "ask about this" to the hub's chat, which is
              the only chat there is now. Renders nothing. */}
          <AssistantHandoff />
          {/* Answers "get the Pass" from surfaces that have no modal of their
              own - a card's Deep Scan chip, wherever that card is rendered. */}
          <PassGate />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </HelmetProvider>
);

export default App;
