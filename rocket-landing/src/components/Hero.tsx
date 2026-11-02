import { Check, Download } from 'lucide-react';

import { GithubIcon } from '@/components/GithubIcon';
import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Eyebrow } from '@/components/Section';
import { RocketLaunch } from '@/components/illustrations';
import { buttonVariants } from '@/components/ui/button-variants';
import { links, sections } from '@/lib/site';
import { cn } from '@/lib/utils';

const facts = ['Linux, macOS and Windows', 'MIT licensed', 'No account, ever'];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <Backdrop />

      <div className="relative mx-auto w-full max-w-6xl px-5 pt-16 pb-20 sm:px-8 sm:pt-24 lg:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <Eyebrow className="justify-center">rocket · desktop api client</Eyebrow>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-6 font-heading text-[1.75rem] leading-[1.1] font-semibold tracking-tighter text-balance sm:text-[2.75rem] sm:leading-[1.06] lg:text-[3.6rem]">
              An API client that fits in <span className="text-primary">146&nbsp;MB</span> and never
              asks you to sign in.
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              Rocket is a native desktop client for HTTP, GraphQL, gRPC and WebSocket. Collections
              are plain YAML on disk with real git inside. A built-in AI assistant proposes changes
              for you to approve, and Flow wires saved requests into a graph you can run.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={`#${sections.download}`}
                className={cn(
                  buttonVariants({ variant: 'primary', size: 'lg' }),
                  'w-full sm:w-auto',
                )}
              >
                <Download />
                Download Rocket
              </a>
              <a
                href={links.github}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'w-full sm:w-auto',
                )}
              >
                <GithubIcon />
                View on GitHub
              </a>
            </div>
          </Reveal>

          <Reveal delay={240}>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {facts.map((fact) => (
                <li
                  key={fact}
                  className="flex items-center gap-1.5 font-heading text-[11px] tracking-wide text-muted-foreground"
                >
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                  {fact}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={300} className="mt-14 sm:mt-20">
          <ScreenshotFrame
            src="/screenshots/main-editor.png"
            alt="The Rocket request editor, with the collection tree on the left and the response pane on the right"
            title="Rocket — collections / users / create user"
            illustration={RocketLaunch}
            aspect="aspect-16/10"
            priority
          />
        </Reveal>
      </div>
    </section>
  );
}

/** Hairline grid and two soft teal washes, both drawn from the theme tokens. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 75%)',
        }}
      />
      <div className="absolute -top-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute top-24 -right-40 size-[26rem] rounded-full bg-primary/5 blur-3xl" />
    </div>
  );
}
