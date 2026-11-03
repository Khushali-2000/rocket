import { ArrowLeftRight, CloudOff, HardDrive, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ImageLightbox } from '@/components/ImageLightbox';
import { Reveal } from '@/components/Reveal';
import { Section, SectionHeader } from '@/components/Section';
import { RocketCloud } from '@/components/illustrations';

const claims: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CloudOff,
    title: 'No account to create',
    body: 'Install it and start working. There is no sign-in wall, no workspace to provision and no seat to reconcile at renewal. Postman asks you to sign in; Rocket has nothing to sign in to.',
  },
  {
    icon: HardDrive,
    title: 'Your data sits in ~/.rocket-api',
    body: 'Collections, environments and history are files on your own disk. Back them up, grep them, commit them, or delete the folder — all of it is yours to handle, in formats you can read without Rocket open.',
  },
  {
    icon: WifiOff,
    title: 'Offline is just normal',
    body: 'Nothing phones home between requests, so a flight, a locked-down network or an air-gapped environment is an ordinary place to work rather than a degraded mode.',
  },
  {
    icon: ArrowLeftRight,
    title: 'The door swings both ways',
    body: 'Import from Postman, Bruno or WSDL with the format auto-detected. Export any collection as a Bruno ZIP or a Postman v2.1 file with environments bundled. Leaving should cost as little as arriving.',
  },
];

export function LocalFirstSection() {
  return (
    <Section>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-16">
        <div>
          <SectionHeader
            eyebrow="local_first:"
            title="No cloud. Your data stays yours."
            lede="Rocket is a desktop app that reads and writes files. That is the whole architecture, and it is the reason there is nothing to leak, nothing to subscribe to, and nothing to lose access to."
          />
          <Reveal delay={120}>
            <RocketCloud className="mt-10 hidden h-44 w-44 lg:block" />
          </Reveal>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {claims.map((claim, index) => {
            const Icon = claim.icon;
            return (
              <Reveal key={claim.title} delay={index * 60}>
                <div className="h-full rounded-xl border border-border bg-card p-6 transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-4 font-heading text-[15px] font-semibold tracking-tight">
                    {claim.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    {claim.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>

      <Reveal delay={240} className="mt-6">
        <div className="grid grid-cols-1 items-center gap-8 rounded-xl border border-border bg-card p-6 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          <div>
            <h3 className="font-heading text-[15px] font-semibold tracking-tight">
              Arriving from Postman or Bruno costs one dialog
            </h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              Paste a link or pick a file, the format is auto-detected, and folders can be grouped
              by tag or by path on the way in — your existing collection, not a rebuild of it.
            </p>
          </div>
          <ImageLightbox
            src="/screenshots/import-collection.png"
            alt="Rocket's Import Collection dialog, with Bruno, Postman, WSDL and OpenAPI source tabs"
            className="block w-full rounded-lg border border-border"
          />
        </div>
      </Reveal>
    </Section>
  );
}
