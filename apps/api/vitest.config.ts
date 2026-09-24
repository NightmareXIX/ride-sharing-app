import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // Test files share one database; run them one at a time so they can't interfere.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
