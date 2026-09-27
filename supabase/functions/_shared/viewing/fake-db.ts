// An in-memory stand-in for the supabase client, for the end-to-end test.
//
// Narrow on purpose: it answers exactly the reads and writes the viewing
// modules make, and nothing else. A general fake would be a second
// implementation of postgrest to get subtly wrong, and a test that passes
// against a wrong fake is worse than no test.
//
// What it does model faithfully is the two things the code actually depends
// on: the unique index on `messages.idempotency_key`, and the fact that
// `events` is append-only.

export interface FakeRow { [k: string]: unknown }

export class FakeDb {
  tables: Record<string, FakeRow[]> = {
    renters: [],
    viewing_requests: [],
    request_items: [],
    events: [],
    messages: [],
    jobs: [],
    external_properties: [],
  };

  private seq = 0;
  nextId(prefix: string) { return `${prefix}${++this.seq}`; }

  /** The ops view, computed rather than stored - same join the migration does. */
  private opsItemsView(): FakeRow[] {
    return this.tables.request_items.map(ri => {
      const listing = this.tables.external_properties.find(p => p.id === ri.listing_id) ?? {};
      const request = this.tables.viewing_requests.find(r => r.id === ri.request_id) ?? {};
      return {
        id: ri.id,
        request_id: ri.request_id,
        request_ref: request.ref,
        listing_id: ri.listing_id,
        realtor_id: ri.realtor_id ?? null,
        price_vnd_at_request: ri.price_vnd_at_request,
        sort_order: ri.sort_order ?? null,
        listing_title: listing.title ?? null,
        listing_url: listing.source_url ?? null,
        district_code: listing.district_code ?? null,
        // The broker's number, through realtors - the one contact the ops
        // view does carry, because the operator rings them.
        realtor_phone: (this.tables.realtors ?? []).find(r => r.id === ri.realtor_id)?.phone_e164 ?? null,
        // Note what is absent: every renters column. The real view omits them
        // so a careless change cannot leak one (invariant 4), and a fake that
        // exposed them would let a test pass on code that leaks.
      };
    });
  }

  from(table: string) {
    const source = () => (table === 'ops_request_items_view' ? this.opsItemsView() : (this.tables[table] ??= []));
    let rows: FakeRow[] = [...source()];

    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        rows = rows.filter(r => (col.includes('->>')
          ? (r[col.split('->>')[0]] as FakeRow)?.[col.split('->>')[1].replace(/'/g, '')] === val
          : r[col] === val));
        return api;
      },
      is: (col: string, val: unknown) => { rows = rows.filter(r => (r[col] ?? null) === val); return api; },
      in: (col: string, vals: unknown[]) => { rows = rows.filter(r => vals.includes(r[col])); return api; },
      gte: (col: string, val: string) => { rows = rows.filter(r => String(r[col]) >= val); return api; },
      order: (col: string, o?: { ascending?: boolean }) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const x = String(a[col] ?? ''), y = String(b[col] ?? '');
          return x === y ? dir * (Number(a.id) - Number(b.id) || 0) : dir * (x < y ? -1 : 1);
        });
        return api;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return api; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (r: { data: FakeRow[]; error: null }) => unknown) => resolve({ data: rows, error: null }),

      insert: (row: FakeRow | FakeRow[]) => {
        const list = Array.isArray(row) ? row : [row];
        const inserted: FakeRow[] = [];
        for (const r of list) {
          // The unique index on messages.idempotency_key, modelled - the
          // persist-then-send path depends on 23505 coming back.
          if (table === 'messages' && this.tables.messages.some(m => m.idempotency_key === r.idempotency_key)) {
            return {
              select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505' } }) }),
              then: (resolve: (x: { data: null; error: { code: string } }) => unknown) =>
                resolve({ data: null, error: { code: '23505' } }),
            };
          }
          const withId: FakeRow = {
            id: r.id ?? this.nextId(table.slice(0, 2)),
            created_at: new Date().toISOString(),
            // `events.occurred_at` is NOT NULL DEFAULT now() in the schema.
            // Without it here the column arrives undefined, every offer parses
            // as an unreadable date, and the selection path looks broken when
            // it is the fake that is wrong.
            ...(table === 'events' ? { occurred_at: new Date().toISOString() } : {}),
            ...r,
          };
          (this.tables[table] ??= []).push(withId);
          inserted.push(withId);
        }
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted[0], error: null }),
            then: (resolve: (x: { data: FakeRow[]; error: null }) => unknown) =>
              resolve({ data: inserted, error: null }),
          }),
          then: (resolve: (x: { data: FakeRow[]; error: null }) => unknown) =>
            resolve({ data: inserted, error: null }),
        };
      },

      update: (patch: FakeRow) => {
        const target = api as unknown as { _filters: ((r: FakeRow) => boolean)[] };
        void target;
        const chain = {
          // `payload->>item_id` as select's eq reads it: completing a job by
          // what it is about is the one update that filters on JSON.
          eq: (col: string, val: unknown) => {
            rows = rows.filter(r => (col.includes('->>')
              ? (r[col.split('->>')[0]] as FakeRow)?.[col.split('->>')[1].replace(/'/g, '')] === val
              : r[col] === val));
            return chain;
          },
          is: (col: string, val: unknown) => { rows = rows.filter(r => (r[col] ?? null) === val); return chain; },
          then: (resolve: (x: { data: null; error: null }) => unknown) => {
            for (const r of rows) Object.assign(r, patch);
            return resolve({ data: null, error: null });
          },
        };
        return chain;
      },

      delete: () => ({
        eq: (col: string, val: unknown) => {
          this.tables[table] = (this.tables[table] ?? []).filter(r => r[col] !== val);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
    return api;
  }

  // deno-lint-ignore no-explicit-any
  rpc(_name: string, _args?: Record<string, unknown>): Promise<{ data: any; error: null }> {
    return Promise.resolve({ data: null, error: null });
  }

  auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
  };
}
