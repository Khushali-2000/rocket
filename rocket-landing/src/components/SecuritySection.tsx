import { EyeOff, FileLock2, Fingerprint, ScanLine, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketFolder } from '@/components/illustrations';
import { sections } from '@/lib/site';

interface Guard {
  icon: LucideIcon;
  title: string;
  body: string;
}

const guards: Guard[] = [
  {
    icon: FileLock2,
    title: 'Examples are masked in the commit',
    body: 'A saved response example can hold a live token, a session cookie or a JWT. Rocket redacts secret-shaped values, auth headers and cookies as the commit is written — not at rest afterwards, where a reviewer has already seen them.',
  },
  {
    icon: EyeOff,
    title: 'The console masks by default',
    body: 'The HTTP log shows masked values until you ask for one. The per-row reveal is a view, not a state change: the unmasked value is never written to disk, and the next render is masked again.',
  },
  {
    icon: ShieldCheck,
    title: 'A trust gate per collection',
    body: 'Open an unfamiliar collection and Rocket lists exactly what it is asking for — developer-mode script access, extra script folders, permission for the agent to run requests, host environment variables — next to what you have actually allowed on this computer.',
  },
  {
    icon: ScanLine,
    title: 'The script sandbox holds by construction',
    body: 'A local require() resolves inside the collection directory, or inside a root you explicitly approved in Developer mode. Paths are canonicalised first, so .. traversal and symlink escapes fail at resolution rather than at a check someone can forget.',
  },
  {
    icon: Fingerprint,
    title: 'A hash-chained audit trail',
    body: 'Security and compliance events are recorded in a tamper-evident chain with configurable compliance profiles, and the evidence exports when an auditor asks for it.',
  },
];

export function SecuritySection() {
  return (
    <Section id={sections.security}>
      <SectionHeader
        eyebrow="security:"
        title="Built for the teams who have to answer for the secrets"
        lede="An API client handles production credentials all day. Rocket treats every place one could leak — the log, the commit, the script loader, an unfamiliar collection — as a thing to close, not a thing to warn about."
      />

      <div className="mt-12 grid grid-cols-1 gap-10 sm:mt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-14">
        <div className="space-y-4">
          {guards.map((guard, index) => {
            const Icon = guard.icon;
            return (
              <Reveal key={guard.title} delay={index * 60}>
                <article className="flex gap-4 rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:border-primary/40">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-heading text-[15px] font-semibold tracking-tight">
                      {guard.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {guard.body}
                    </p>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={100}>
          <ScreenshotFrame
            src="/screenshots/git-panel.png"
            alt="The Rocket git panel, showing staged collection changes with example values already masked"
            title="Rocket — git / staged changes"
            illustration={RocketFolder}
            aspect="aspect-4/3"
          />

          <div className="mt-6 rounded-xl border border-border bg-card p-6">
            <h3 className="font-heading text-sm font-semibold tracking-tight">
              Credentials have three homes, none of them your repo
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              RocketVault, an environment variable, or the operating system keychain. Collections
              reference a secret; they never carry one. Exports blank literal credentials on the
              way out, with no option to include them.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
