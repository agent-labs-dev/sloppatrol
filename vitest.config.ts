import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // No test may reach a real model, whatever keys the shell holds.
    env: Object.fromEntries(
      [
        'OPENROUTER_API_KEY',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'SLOPPATROL_MODEL_ENDPOINT',
        'SLOPPATROL_MODEL_API_KEY',
      ].map((key) => [key, '']),
    ),
  },
});
