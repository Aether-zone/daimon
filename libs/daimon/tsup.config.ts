import { defineConfig } from 'tsup';

export default defineConfig({
  /*
   * Two entry points, and the split is not cosmetic: `.` reaches for
   * `next/headers` and `server-only`, which throw the moment they are pulled
   * into a client bundle. An app that only wants the sign-out layout must be
   * able to import it without dragging the session in behind it.
   *
   * `tsup` skips a missing entry without failing, so a stale path here builds
   * green and ships nothing — keep this list and `exports` in package.json in
   * step.
   */
  entry: [
    'src/index.ts',
    'src/ui/index.ts',
    'src/config-entry/index.ts',
    'src/upload.ts',
    'src/format.ts',
  ],
  tsconfig: 'tsconfig.build.json',
  // ESM only. Every consumer is a Next.js app, and there is no CommonJS one to
  // serve — unlike organon, whose consumers are still-CommonJS Nest builds.
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'next',
    'oauth4webapi',
    'react',
    'react/jsx-runtime',
    'server-only',
  ],
  outDir: 'dist',
});
