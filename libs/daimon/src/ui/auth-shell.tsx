import type { ReactNode } from 'react';

export interface AuthShellBrand {
  /** Shown above the heading below `lg`, where the brand panel is hidden. */
  compactMark: ReactNode;
  /** Shown inside the brand panel, above the wordmark. */
  mark: ReactNode;
  wordmark: string;
  tagline: string;
}

/**
 * Two-panel shell for the signed-out pages: a message column beside a brand
 * panel. No app built on daimon has a sign-in form of its own — pistis owns the
 * credentials — so `/signed-out` is usually the only page that uses it.
 *
 * Deliberately free of kosmos imports so it renders as a Server Component. The
 * brand is passed in as nodes rather than imported, because the logo is the one
 * thing here that is genuinely each app's own.
 */
export function AuthShell({
  title,
  description,
  brand,
  children,
  footer,
}: {
  title: string;
  description: string;
  brand: AuthShellBrand;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-3">
      <section className="flex flex-col justify-center bg-background px-6 py-12 sm:px-10 lg:col-span-1 lg:px-12">
        <div className="mx-auto w-full max-w-sm">
          {/* The brand panel is hidden below `lg`, so carry the mark here. */}
          <div className="mb-10 text-foreground lg:hidden">
            {brand.compactMark}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>

          {children}

          <p className="mt-8 text-sm text-muted-foreground">{footer}</p>
        </div>
      </section>

      <section className="relative isolate hidden overflow-hidden bg-primary lg:col-span-2 lg:flex lg:items-center lg:justify-center">
        {/* A sheen top-left and depth bottom-right over the flat fill. Neutral
            overlays, so it reads the same whichever hue `--primary` is. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.12)_0%,transparent_45%,rgba(0,0,0,0.20)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 size-[32rem] rounded-full bg-white/10 blur-3xl"
        />

        <div className="relative px-16 text-primary-foreground">
          <div className="mb-8">{brand.mark}</div>
          <p className="text-6xl font-semibold tracking-tight xl:text-7xl">
            {brand.wordmark}
          </p>
          <p className="mt-4 text-lg text-primary-foreground/80">
            {brand.tagline}
          </p>
        </div>
      </section>
    </main>
  );
}
