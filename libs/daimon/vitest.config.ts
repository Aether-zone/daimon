import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node rather than jsdom: everything under test here is server or plain
    // logic. `putToSignedUrl` needs an XMLHttpRequest, but it needs a
    // *controllable* one — a real jsdom XHR would want a server to talk to.
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
  },
});
