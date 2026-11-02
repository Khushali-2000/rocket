import { Apple, Download, MonitorDown, Scale, Terminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { GithubIcon } from '@/components/GithubIcon';
import { Reveal } from '@/components/Reveal';
import { Eyebrow } from '@/components/Section';
import { RocketLiftOff } from '@/components/illustrations';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatAssetSize, release } from '@/lib/release';
import { links, sections } from '@/lib/site';
import { cn } from '@/lib/utils';

const platforms: { icon: LucideIcon; name: string; detail: string; href: string }[] = [
  {
    icon: Terminal,
    name: 'Linux',
    detail: `.deb · ${formatAssetSize(release.assets.linux.size)}`,
    href: release.assets.linux.url,
  },
  {
    icon: Apple,
    name: 'macOS',
    detail: `Apple Silicon · ${formatAssetSize(release.assets.macos.size)}`,
    href: release.assets.macos.url,
  },
  {
    icon: MonitorDown,
    name: 'Windows',
    detail: `.exe · ${formatAssetSize(release.assets.windows.size)}`,
    href: release.assets.windows.url,
  },
];

export function FinalCta() {
  return (
    <section id={sections.download} className="relative scroll-mt-16 overflow-hidden border-t border-border bg-muted/40">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24 lg:py-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <Reveal>
              <Eyebrow>download:</Eyebrow>
              <h2 className="mt-4 font-heading text-[1.6rem] leading-[1.14] font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.6rem]">
                Install it. Open a collection. See how little it costs you.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Native builds for all three desktops. No account, no trial, no seat count — MIT
                licensed and open source, so the whole thing is readable before you run it.
              </p>
            </Reveal>

            <Reveal delay={80}>
              <div className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {platforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <a
                      key={platform.name}
                      href={platform.href}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-heading text-sm font-semibold tracking-tight">
                          {platform.name}
                        </span>
                        <span className="block font-heading text-[11px] text-muted-foreground">
                          {platform.detail}
                        </span>
                      </span>
                      <Download
                        className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </a>
                  );
                })}
              </div>
            </Reveal>

            <Reveal delay={140}>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <a
                  href={links.github}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}
                >
                  <GithubIcon />
                  Read the source
                </a>
                <p className="flex items-center gap-2 font-heading text-[11px] tracking-wide text-muted-foreground">
                  <Scale className="size-3.5 text-primary" aria-hidden="true" />
                  MIT licensed · Linux, macOS and Windows
                </p>
                <a
                  href={release.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-heading text-[11px] tracking-wide text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Other formats (.rpm, .AppImage, .msi) and release notes
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={180} className="hidden lg:block">
            <RocketLiftOff className="mx-auto h-72 w-72" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
