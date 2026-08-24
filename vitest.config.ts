import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    /**
     * Pinned, because CI runs `ubuntu-latest` with no `TZ` — i.e. UTC — and a
     * timezone test under UTC is a tautology. `isBirthday` compares local
     * calendar components; swapping them for `getUTCMonth`/`getUTCDate` was
     * green under UTC and red under this zone. The suite had a test named
     * "turns over at local midnight, not UTC" that could not fail in the only
     * environment that gates a PR.
     *
     * No test count is quoted, here or in `packages/packs/src/index.test.ts`.
     * The first version of both comments did, and one was stale within the
     * hour — `packages/cli/src/daemon.ts` already records the same lesson from
     * three other files.
     *
     * Europe/London is chosen for one property only: the dates under test are
     * in September, when it is BST and an hour off UTC. It is **not** off UTC
     * in winter, so this pins a zone that is non-UTC *for those dates* rather
     * than a non-UTC zone — which is why the test that needs it asserts the
     * offset is non-zero rather than trusting this line.
     */
    env: { TZ: 'Europe/London' },
  },
});
