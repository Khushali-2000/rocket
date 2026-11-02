import { FileDown, Gauge, Waves } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal } from '@/components/Reveal';
import { ScreenshotFrame } from '@/components/ScreenshotFrame';
import { Section, SectionHeader } from '@/components/Section';
import { RocketClock } from '@/components/illustrations';

const points: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Waves,
    title: 'Shape the load',
    body: 'Phase-based runs with ramp-up, hold and ramp-down, or a flat run pinned to a fixed concurrency or a fixed requests-per-second.',
  },
  {
    icon: Gauge,
    title: 'Watch it happen',
    body: 'Latency, throughput, error rate and concurrency chart live while the run is in flight, with percentile stats rather than an average that hides the tail.',
  },
  {
    icon: FileDown,
    title: 'Take the result with you',
    body: 'Export the run as HTML, CSV, JSON or PDF — one for the ticket, one for the spreadsheet, one for the person who asked.',
  },
];

export function LoadTestingSection() {
  return (
    <Section tone="muted">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-14">
        <div>
          <SectionHeader
            eyebrow="load_testing:"
            title="Load testing, in the same app as the request"
            lede="No second tool, no exported script, no separate runner to keep in sync. Point a run at a request you already have."
          />

          <div className="mt-8 space-y-5">
            {points.map((point, index) => {
              const Icon = point.icon;
              return (
                <Reveal key={point.title} delay={index * 70}>
                  <div className="flex gap-4">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
                      <Icon className="size-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-[15px] font-semibold tracking-tight">
                        {point.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {point.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>

        <Reveal delay={100}>
          <ScreenshotFrame
            src="/screenshots/load-testing.png"
            alt="The Rocket load testing dashboard, with live latency, throughput and error-rate charts"
            title="Rocket — load test / checkout burst"
            illustration={RocketClock}
            aspect="aspect-4/3"
          />
        </Reveal>
      </div>
    </Section>
  );
}
