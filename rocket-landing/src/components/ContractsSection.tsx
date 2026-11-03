import { AlertTriangle, FileDown, Handshake } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ImageLightbox } from '@/components/ImageLightbox';
import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketBook } from '@/components/illustrations';
import { sections } from '@/lib/site';

interface Trait {
  icon: LucideIcon;
  title: string;
  body: string;
}

const traits: Trait[] = [
  {
    icon: Handshake,
    title: 'Scoped to what it actually covers',
    body: 'Attach a contract to a whole collection, one folder, or a single request. Provider and consumer teams, an effective date, and an expiry are declared up front — not implied by a Slack thread.',
  },
  {
    icon: AlertTriangle,
    title: "Breaking changes don't wait for a bug report",
    body: 'Pick a breaking-change policy — strict, lenient or additive-OK — and Rocket watches every endpoint in scope. Drift and breaches land in a changelog the moment they happen, not when a consumer team notices in production.',
  },
  {
    icon: FileDown,
    title: "Evidence for the people who weren't in the room",
    body: 'Export the contract as OpenAPI YAML or a native PDF when someone outside the team asks what was promised, to whom, and since when.',
  },
];

export function ContractsSection() {
  return (
    <Section id={sections.contracts}>
      <SectionHeader
        eyebrow="contracts:"
        title="An SLA that gets enforced, not just filed in a wiki"
        lede="Most teams track what an API promises in tribal knowledge and hope it survives the next release. Rocket turns that promise into a contract it actively watches."
      />

      <Reveal className="mt-12 sm:mt-14">
        <ScreenshotFrame
          src="/screenshots/contracts-overview.png"
          alt="The Rocket Contracts dashboard, showing total, active, drifting and breaching contracts, with a provider/consumer contract listed below"
          title="Rocket — contracts / api-4"
          illustration={RocketBook}
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
              The terms, written down once
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Title, version, provider and consumer teams, scope down to a single request if that
              is all it covers, an effective window, a breaking-change policy, a notice period and
              an uptime SLA — set once when the contract is created, not re-explained every time
              someone asks what it covers.
            </p>
          </div>
          <ImageLightbox
            src="/screenshots/new-contract.png"
            alt="The Rocket new-contract form, with provider and consumer teams, scope, effective dates, breaking-change policy and uptime SLA fields"
            className="block w-full rounded-lg border border-border"
          />
        </div>
      </Reveal>
    </Section>
  );
}
