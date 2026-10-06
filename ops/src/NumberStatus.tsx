// The WhatsApp number's standing with Meta, and any of our templates whose
// quality is slipping (number-health.ts). Read from what whatsapp-template-sync
// stores every hour; nothing here calls Meta.
//
// NumberAlert sits under the nav on every screen and shows only when something
// is wrong - the digest has held itself, or a template is close to being
// paused. NumberStatus is the full card on the AI operator page.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { hcmc } from '../../supabase/functions/_shared/viewing/triage';
import { marketingHold, type NumberStatusRow } from '../../supabase/functions/_shared/whatsapp/number-health';
import { TEMPLATES } from '../../supabase/functions/_shared/whatsapp/templates';

interface TemplateRow { name: string; status: string; quality: string | null }

const OURS = new Set<string>(Object.values(TEMPLATES).map(t => t.name));

/** Rated down, or stopped by Meta after approval - either is worth a look before it bites. */
const isSlipping = (t: TemplateRow) =>
  OURS.has(t.name)
  && (['YELLOW', 'RED'].includes((t.quality ?? '').toUpperCase()) || ['PAUSED', 'DISABLED'].includes(t.status.toUpperCase()));

const describe = (t: TemplateRow) =>
  `${t.name} (${['PAUSED', 'DISABLED'].includes(t.status.toUpperCase()) ? t.status.toLowerCase() : `quality ${t.quality}`})`;

function useNumberHealth() {
  const [row, setRow] = useState<NumberStatusRow | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const load = useCallback(async () => {
    const [{ data: n }, { data: t }] = await Promise.all([
      supabase.from('whatsapp_number_status')
        .select('quality_rating, status, checked_at, previous_rating, rating_changed_at, last_error')
        .eq('id', 'singleton').maybeSingle(),
      supabase.from('whatsapp_template_status').select('name, status, quality'),
    ]);
    setRow((n as NumberStatusRow) ?? null);
    setTemplates((t as TemplateRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
    // The sync runs hourly; five minutes is soon enough to notice a change.
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return { row, hold: marketingHold(row), stalled: templates.filter(isSlipping) };
}

export function NumberAlert() {
  const { hold, stalled } = useNumberHealth();
  if (!hold && stalled.length === 0) return null;
  return (
    <div className="error" style={{ marginBottom: 12 }}>
      {hold && (
        <div>
          <strong>WhatsApp digest held:</strong> {hold}. Itineraries and replies still go out; the digest
          resumes by itself once Meta rates the number GREEN again.
        </div>
      )}
      {stalled.length > 0 && <div>Templates slipping at Meta: {stalled.map(describe).join(', ')}.</div>}
    </div>
  );
}

export function NumberStatus() {
  const { row, hold, stalled } = useNumberHealth();
  if (!row) return null;
  const rating = (row.quality_rating ?? '').toUpperCase();
  const tone = rating === 'GREEN' ? 'good' : rating === 'YELLOW' ? 'warn' : rating === 'RED' ? 'bad' : '';

  return (
    <div className="card">
      <div className="row wrap-row">
        <strong>WhatsApp number</strong>
        <span className={`tag ${tone}`}>{row.quality_rating ?? 'not read yet'}</span>
        {row.status && row.status !== 'CONNECTED' && <span className="tag bad">{row.status.toLowerCase()}</span>}
        {hold && <span className="tag bad">digest held</span>}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {row.checked_at ? `Checked ${hcmc(row.checked_at)}` : 'Not read yet - the hourly template sync fills this in'}
        {row.previous_rating && row.rating_changed_at ? ` - was ${row.previous_rating} until ${hcmc(row.rating_changed_at)}` : ''}
      </div>
      {stalled.length > 0 && (
        <div className="small age-warn" style={{ marginTop: 4 }}>Templates slipping: {stalled.map(describe).join(', ')}</div>
      )}
      {row.last_error && <div className="small error" style={{ marginTop: 4 }}>{row.last_error}</div>}
    </div>
  );
}
