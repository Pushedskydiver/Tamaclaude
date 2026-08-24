import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    /**
     * Pinned, because CI runs `ubuntu-latest` with no `TZ` — i.e. UTC — and a
     * timezone test under UTC is a tautology. `isBirthday` compares local
     * calendar components; swapping them for `getUTCMonth`/`getUTCDate` kept
     * all 11 packs tests green under UTC and killed 2 under this zone. The
     * suite had a test named "turns over at local midnight, not UTC" that
     * could not fail in the only environment that gates a PR.
     *
     * Europe/London because it is where the device sits, and because the
     * dates under test are in September, when it is BST and an hour off UTC.
     * It is *not* off UTC in winter — so the test that needs this also
     * asserts the offset is non-zero rather than trusting this line.
     */
    env: { TZ: 'Europe/London' },
  },
});
