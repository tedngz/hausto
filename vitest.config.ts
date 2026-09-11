import { defineConfig } from 'vitest/config';

// Unit tests only, and deliberately narrow. The domain reducer is pure
// TypeScript with no Deno APIs, which is what lets vitest run a file that ships
// inside an edge function bundle.
export default defineConfig({
  test: {
    include: ['supabase/functions/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
