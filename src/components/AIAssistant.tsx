import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Send, X, RotateCcw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ASSISTANT_OPEN_EVENT, type AssistantOpenDetail } from '@/lib/assistantEvents';

// Hausto Assistant: platform-wide floating AI chat, docked at the bottom-right
// so it sits alongside Browse / Swipe / Matches instead of covering them, and
// opposite the Hausto messaging chat which docks left.
// Opens straight into the AI conversation - advice, property info, and
// owner/realtor contact reveals (10/day free, unlimited premium). It does not
// return search results; that stays in the main AI Search view.

// Every property card's sparkle fires ASSISTANT_OPEN_EVENT, so the assistant
// needs no wiring on the surfaces that show cards.

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  limitReached?: boolean;
}

const GREETING =
  "Hi! I'm the Hausto Assistant ✨ Ask me anything about renting in Vietnam, your matched properties, or say \"get me the contact\" for a listing and I'll share the owner/realtor's details. (For finding new homes, use AI Search or Browse.)";

// With a subject listing the chips name it, so the request carries the
// property in the message rather than relying on the model to infer it from
// context - and the transcript reads back clearly later.
const quickChips = (subjectTitle?: string): { label: string; text: string }[] => [
  subjectTitle
    ? { label: '📞 Get this owner’s contact', text: `Get me the owner's contact for "${subjectTitle}"` }
    : { label: '📞 Get an owner’s contact', text: 'Get an owner’s contact' },
  subjectTitle
    ? { label: 'Is it still available?', text: `Is "${subjectTitle}" still available?` }
    : { label: 'Tips for my first viewing', text: 'Tips for my first viewing' },
  { label: 'What should I know about deposits?', text: 'What should I know about deposits?' },
];

const HISTORY_CAP = 40;

export const AIAssistant = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [contactsRemaining, setContactsRemaining] = useState<number | null>(null);
  // Listing the conversation is about when the assistant was summoned from a
  // card's sparkle. Takes precedence over the one read from the URL.
  const [contextProperty, setContextProperty] = useState<AssistantOpenDetail | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const storageKey = user ? `haustoAssistant_${user.id}` : null;

  // Hydrate the conversation from localStorage so it follows the user across
  // pages and sessions; seed the greeting on first open.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed: AssistantMessage[] = stored ? JSON.parse(stored) : [];
      setMessages(parsed.length > 0 ? parsed : [{ id: 'greeting', role: 'assistant', content: GREETING }]);
    } catch {
      setMessages([{ id: 'greeting', role: 'assistant', content: GREETING }]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || messages.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-HISTORY_CAP)));
    } catch {
      // Quota errors are non-fatal - the chat just won't persist.
    }
  }, [messages, storageKey]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [messages, isOpen]);

  // When the user is on a listing page, pass that property so "get me the
  // contact for this one" resolves without naming it. A card's sparkle names
  // the listing explicitly, which wins over whatever page we happen to be on.
  const urlPropertyId = location.pathname.match(/^\/property\/([^/]+)/)?.[1] ?? null;
  const contextPropertyId = contextProperty?.propertyId ?? urlPropertyId;

  // Opened from a property card's sparkle. Signed-out visitors have no
  // assistant, so send them to sign in rather than clicking into nothing.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDetail>).detail;
      if (!user) {
        navigate('/auth');
        return;
      }
      setContextProperty(detail?.propertyId ? detail : null);
      setIsOpen(true);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [user, navigate]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isSending) return;
    setInput('');
    setIsSending(true);
    const userMsg: AssistantMessage = { id: `u-${Date.now()}`, role: 'user', content };
    setMessages(prev => [...prev, userMsg]);

    try {
      const history = [...messages, userMsg]
        .slice(-16)
        .map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: history, contextPropertyId },
      });
      if (error) throw error;
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data?.reply || 'Sorry, I had trouble answering that. Please try again.',
        limitReached: !!data?.limitReached,
      }]);
      if (typeof data?.contactsRemaining === 'number') {
        setContactsRemaining(data.contactsRemaining);
      } else if (data?.contactsRemaining === null) {
        setContactsRemaining(null);
      }
    } catch (err) {
      console.error('[AIAssistant] send failed:', err);
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, something went wrong - please try again in a moment.',
      }]);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, messages, contextPropertyId]);

  const handleUpgrade = () => {
    if (location.pathname === '/discover') {
      window.dispatchEvent(new CustomEvent('openSubscriptionModal'));
    } else {
      navigate('/discover');
    }
    setIsOpen(false);
  };

  const resetConversation = () => {
    setMessages([{ id: 'greeting', role: 'assistant', content: GREETING }]);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  if (!user) return null;

  return (
    <>
      {/* Launcher - bottom-right, sparkle */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          aria-label="Open Hausto Assistant"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 shadow-lg hover:shadow-xl transition-all duration-200"
        >
          <Sparkles className="w-6 h-6 text-white" />
        </Button>
      )}

      {/* Docked chat box - non-modal so the page stays usable alongside it */}
      {isOpen && (
        <div
          role="complementary"
          aria-label="Hausto Assistant chat"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:bottom-6 sm:right-6 z-50 sm:w-[380px] max-w-full h-[520px] max-h-[75vh] flex flex-col rounded-2xl border border-purple-200/60 bg-white shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Hausto Assistant</p>
              <p className="text-[11px] text-white/80 leading-tight">Advice · property info · contacts</p>
            </div>
            <button
              onClick={resetConversation}
              aria-label="Start a new conversation"
              title="Start a new conversation"
              className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close assistant"
              className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Which listing the assistant was summoned about, when it was */}
          {contextProperty?.propertyId && (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border-b border-purple-100 flex-shrink-0">
              <Sparkles className="w-3 h-3 text-purple-600 flex-shrink-0" />
              <p className="flex-1 min-w-0 text-[11px] text-purple-900 truncate">
                About: {contextProperty.title || 'this listing'}
              </p>
              <button
                onClick={() => setContextProperty(null)}
                aria-label="Stop asking about this listing"
                className="p-0.5 rounded-full hover:bg-purple-200/60 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3 text-purple-700" />
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gradient-to-b from-purple-50/40 to-white">
            {messages.map(message => (
              <div key={message.id}>
                {message.role === 'assistant' ? (
                  <div className="flex gap-2 items-start">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white border border-purple-100 px-3 py-2 shadow-sm">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                      {message.limitReached && (
                        <Button
                          size="sm"
                          onClick={handleUpgrade}
                          className="mt-2 h-7 text-xs rounded-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white"
                        >
                          ✨ Upgrade for unlimited contacts
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-orange-500 to-pink-600 text-white px-3 py-2 shadow-sm">
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isSending && (
              <div className="flex gap-2 items-center">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="rounded-full bg-white border border-purple-100 px-3 py-1.5 flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <div className="p-2.5 border-t border-purple-100 bg-white flex-shrink-0 space-y-2">
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {quickChips(contextProperty?.title).map(chip => (
                <button
                  key={chip.label}
                  disabled={isSending}
                  onClick={() => sendMessage(chip.text)}
                  className="shrink-0 text-xs h-7 px-3 rounded-full border border-purple-200/70 bg-purple-50/60 hover:bg-purple-100 text-purple-700 transition-colors disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask the assistant..."
                disabled={isSending}
                className="flex-1 text-sm rounded-xl border-purple-200/70 focus-visible:ring-purple-400"
              />
              <Button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isSending}
                aria-label="Send message"
                className="w-10 h-10 p-0 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            {contactsRemaining !== null && (
              <p className="text-[11px] text-gray-400 text-center leading-none">
                {contactsRemaining} of 10 free contact reveals left today
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
