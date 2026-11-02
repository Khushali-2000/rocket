import { Cpu, TriangleAlert } from 'lucide-react';

import { CompareBarGroup, type CompareRow } from '@/components/CompareBar';
import { Reveal } from '@/components/Reveal';
import { Section, SectionHeader } from '@/components/Section';
import { RocketSpeed } from '@/components/illustrations';
import { benchmarkMeta, sections } from '@/lib/site';

const rows: CompareRow[] = [
  {
    metric: 'Install size, unpacked',
    goal: 'lower is better',
    entries: [
      { name: 'Rocket', display: '146 MB', value: 146 },
      { name: 'Bruno', display: '527 MB', value: 527 },
      { name: 'Postman', display: '653 MB', value: 653 },
    ],
  },
  {
    metric: 'Download size',
    goal: 'lower is better',
    entries: [
      { name: 'Rocket', display: '48.4 MB', value: 48.4, note: '.deb' },
      { name: 'Bruno', display: 'not measured', value: null },
      { name: 'Postman', display: '174 MB', value: 174, note: 'snap' },
    ],
  },
  {
    metric: 'Idle memory (PSS)',
    goal: 'lower is better',
    entries: [
      { name: 'Rocket', display: '~262 MB', value: 262, note: '3 proc' },
      { name: 'Bruno', display: '~566 MB', value: 566, note: '7 proc' },
      { name: 'Postman', display: '~516 MB', value: 516, note: '7 proc' },
    ],
  },
  {
    metric: 'Idle private memory',
    goal: 'lower is better',
    entries: [
      { name: 'Rocket', display: '151 MB', value: 151 },
      { name: 'Bruno', display: '480 MB', value: 480 },
      { name: 'Postman', display: '311 MB', value: 311 },
    ],
  },
  {
    metric: 'Idle CPU',
    goal: 'lower is better',
    entries: [
      { name: 'Rocket', display: '~1%', value: 1 },
      { name: 'Bruno', display: '~0%', value: 0.2 },
      { name: 'Postman', display: '~7%', value: 7, note: 'signed in' },
    ],
  },
  {
    metric: 'Startup to drawn UI',
    goal: 'lower is better',
    rocketLoses: true,
    entries: [
      { name: 'Rocket', display: '~10.4 s', value: 10.4 },
      { name: 'Bruno', display: '~4.2 s', value: 4.2 },
      { name: 'Postman', display: '~2.2 s', value: 2.2 },
    ],
  },
];

export function BenchmarkSection() {
  return (
    <Section id={sections.benchmarks} tone="muted">
      <SectionHeader
        eyebrow="benchmarks:"
        title="The full table, including the row we lose"
        lede={`All three clients installed and measured on ${benchmarkMeta.machine}, ${benchmarkMeta.measuredOn}. ${benchmarkMeta.versions}. The full methodology is published alongside the benchmark.`}
      />

      <div className="mt-12 grid grid-cols-1 gap-8 sm:mt-14 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
        <Reveal>
          <div className="rounded-xl border border-border bg-card px-5 py-1 sm:px-7 sm:py-2">
            {rows.map((row, index) => (
              <div
                key={row.metric}
                className={index > 0 ? 'border-t border-border' : undefined}
              >
                <CompareBarGroup row={row} />
              </div>
            ))}
          </div>
        </Reveal>

        <div className="space-y-4">
          <Reveal delay={70}>
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-6">
              <div className="flex items-center gap-2.5">
                <TriangleAlert className="size-[18px] shrink-0 text-warning" aria-hidden="true" />
                <h3 className="font-heading text-sm font-semibold tracking-tight">
                  Where Rocket loses
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Cold start. Roughly 10.4 seconds to a drawn UI, against Bruno at 4.2 and Postman at
                2.2 — the slowest of the three, by a lot. It is on the chart because a comparison
                that only shows the wins is worth nothing. We are working on it.
              </p>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-2.5">
                <Cpu className="size-[18px] shrink-0 text-primary" aria-hidden="true" />
                <h3 className="font-heading text-sm font-semibold tracking-tight">
                  Why the rest is small
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Rocket renders in the WebView the operating system already ships — WebKitGTK,
                WKWebView or WebView2 — instead of bundling a second copy of Chromium. The backend
                is Rust, so there is no garbage collector, no JVM and no Node runtime sitting
                underneath it, and nothing polls a cloud in the background.
              </p>
              <RocketSpeed className="mx-auto mt-6 h-28 w-28" />
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
