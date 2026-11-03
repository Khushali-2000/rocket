import { FolderSync, Lock, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ImageLightbox } from '@/components/ImageLightbox';
import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketTelescope } from '@/components/illustrations';
import { sections } from '@/lib/site';

interface Trait {
  icon: LucideIcon;
  title: string;
  body: string;
}

const traits: Trait[] = [
  {
    icon: FolderSync,
    title: 'The collection tracks the real spec',
    body: 'Point Rocket at an OpenAPI 3.0, 3.1 or Swagger 2.0 file — a link or a local path — and it checks for changes on an interval you set, instead of someone remembering to re-import after every release.',
  },
  {
    icon: Search,
    title: 'Every endpoint, searchable',
    body: 'Browse the whole spec by method, path or summary without leaving Rocket, and see at a glance how many of its endpoints already match what is in the collection.',
  },
  {
    icon: Lock,
    title: 'Nothing updates without a look first',
    body: 'A changed spec lands in a review queue, not a silent overwrite. The link itself is trusted once, explicitly, on that machine — and disconnecting it leaves your existing requests exactly where they are.',
  },
];

export function OpenApiSyncSection() {
  return (
    <Section id={sections.openapi} tone="muted">
      <SectionHeader
        eyebrow="openapi_sync:"
        title="A collection that doesn't go stale the day after you import it"
        lede="Most clients treat an OpenAPI import as a one-time copy. Rocket keeps the link open, so the spec and the collection stay the same document."
      />

      <Reveal className="mt-12 sm:mt-14">
        <ScreenshotFrame
          src="/screenshots/openapi-sync-overview.png"
          alt="The Rocket OpenAPI sync overview, showing a connected spec with 171 endpoints at 100% in sync and zero spec updates waiting"
          title="Rocket — RocketVault-API / OpenAPI sync"
          illustration={RocketTelescope}
          aspect="aspect-16/10"
        />
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {traits.map((trait, index) => {
          const Icon = trait.icon;
          return (
            <Reveal key={trait.title} delay={index * 70}>
              <div className="h-full rounded-xl border border-border bg-card p-6 transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-heading text-base font-semibold tracking-tight">
                  {trait.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{trait.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={120} className="mt-6">
        <div className="grid grid-cols-1 items-center gap-8 rounded-xl border border-border bg-card p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          <div>
            <h3 className="font-heading text-sm font-semibold tracking-tight">
              You approve the link, and you set the pace
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              A spec link is trusted once, per machine, and only GitHub links can carry an access
              token — kept in the system keychain, never in the collection. Automatic checks run
              on a schedule you pick, from every few minutes to never, and stopping trust pauses
              them without touching a single saved request.
            </p>
          </div>
          <ImageLightbox
            src="/screenshots/openapi-sync-connection-settings.png"
            alt="Rocket's OpenAPI sync connection settings, showing trust status, check frequency and the option to stop trusting or disconnect the link"
            className="block w-full rounded-lg border border-border"
          />
        </div>
      </Reveal>
    </Section>
  );
}
