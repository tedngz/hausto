import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { HomeAI } from '@/components/HomeAI';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { ASSISTANT_OPEN_EVENT } from '@/lib/assistantEvents';

// The floating AI chat, docked bottom-right on every page except the hub -
// which docks the same chat in its own rail rather than floating it.
//
// This is a LAUNCHER, not a second assistant. The panel hosts HomeAI in its
// rail variant, so the conversation, the backend (chat-ai), the pinned-listing
// strip and the daily unlock allowance are all the ones the hub uses. This
// component used to run its own thread against a separate assistant function,
// which meant a contact revealed in one chat was invisible in the other and
// neither chat could do the other's job.
//
// Every property card's sparkle fires ASSISTANT_OPEN_EVENT, so the surfaces
// that show cards need no wiring: the event opens this panel, and HomeAI picks
// the same event up to pin the listing.

export const AIAssistant = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  // The hub docks this chat in its rail; a second floating copy would be a
  // second conversation on the same screen.
  const isHub = location.pathname === '/hub';

  // Opened from a property card's sparkle. Signed-out visitors have no chat, so
  // send them to sign in rather than clicking into nothing.
  useEffect(() => {
    const onOpen = () => {
      if (!user) {
        navigate('/auth');
        return;
      }
      setIsOpen(true);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [user, navigate]);

  if (!user || isHub) return null;

  return (
    <>
      {/* Launcher - bottom-right, sparkle */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          aria-label="Open AI chat"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-gradient-to-tr from-orange-500 to-pink-600 shadow-lg transition-all duration-200 hover:from-orange-600 hover:to-pink-700 hover:shadow-xl"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </Button>
      )}

      {/* Docked panel - non-modal, so the page stays usable alongside it */}
      {isOpen && (
        <div
          role="complementary"
          aria-label="AI chat"
          className="fixed bottom-4 left-4 right-4 z-50 flex h-[560px] max-h-[80dvh] max-w-full flex-col overflow-hidden rounded-2xl border border-orange-200/60 bg-white shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-[400px]"
        >
          <div className="flex flex-shrink-0 items-center gap-2.5 bg-gradient-to-r from-orange-500 to-pink-600 px-4 py-3 text-white">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">AI chat</p>
              <p className="text-[11px] leading-tight text-white/80">
                Search &middot; advice &middot; your listings
              </p>
            </div>
            <button
              aria-label="Collapse AI chat"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-white/20"
              onClick={() => setIsOpen(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* CurrencyProvider is per-page and this component sits above the
              router's pages, so the chat brings its own. */}
          <div className="min-h-0 flex-1">
            <CurrencyProvider>
              <HomeAI variant="rail" />
            </CurrencyProvider>
          </div>
        </div>
      )}
    </>
  );
};
