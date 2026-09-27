import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every test must be deterministic: no network, no real model calls.
    testTimeout: 20_000,
    sequence: { shuffle: false },
  },
});
