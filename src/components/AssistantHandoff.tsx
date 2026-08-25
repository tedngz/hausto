import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { setChatHandoff } from '@/lib/chatHandoff';
import {
  ASSISTANT_COMPARE_EVENT,
  ASSISTANT_OPEN_EVENT,
  type AssistantCompareDetail,
  type AssistantOpenDetail,
} from '@/lib/assistantEvents';

/**
 * "Ask the AI about this", fired from anywhere in the app, routed to the one
 * chat that can answer it.
 *
 * This is what replaced the floating assistant panel that used to be docked on
 * every page but the hub. The panel was a second home for the same chat, and
 * the second home was the problem: it answered in a 400px box with none of the
 * things the answer is about - no results pane, no table, no matches - so a
 * conversation started there had to be started again on the hub. Retiring it
 * leaves one chat, in the place built to hold it.
 *
 * So a card's sparkle off the hub now parks the listing and follows it to the
 * hub, where the rail chat pins it - the same handoff the landing page's
 * composer does with a message. Compare travels the same way, carrying the
 * selection as well, because comparing is both halves at once: the panel in
 * the main pane and the question about it in the rail.
 *
 * Headless: it renders nothing. On the hub it stands aside, because the rail
 * chat listens for the event itself and pins without anyone navigating.
 */
export const AssistantHandoff = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname === '/hub') return;

    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDetail>).detail;
      if (!detail?.propertyId) return;
      // Pinning is a signed-in feature either way: the strip that shows the
      // subjects and the ids that ride along with the message both need an
      // account. Handing a signed-out visitor to the hub would pin nothing, so
      // ask them in first - the same answer the panel used to give.
      if (!user) {
        navigate('/auth', { state: { returnTo: '/hub' } });
        return;
      }
      setChatHandoff({ subjects: [detail] });
      navigate('/hub');
    };

    const onCompare = (event: Event) => {
      const detail = (event as CustomEvent<AssistantCompareDetail>).detail;
      if (!detail?.properties?.length) return;
      const ids = detail.properties
        .map((p) => p.propertyId)
        .filter((id): id is string => !!id);
      // No sign-in wall on this one, unlike a bare sparkle: the prompt names
      // the listings it is about, so the question still stands on its own for
      // a signed-out visitor whose pins would not show.
      setChatHandoff({ subjects: detail.properties, query: detail.prompt, compareIds: ids });
      navigate('/hub');
    };

    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    window.addEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
    return () => {
      window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
      window.removeEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
    };
  }, [user, navigate, location.pathname]);

  return null;
};
