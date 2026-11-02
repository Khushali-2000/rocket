import { sections } from '@/lib/site';

interface Stat {
  value: string;
  unit?: string;
  label: string;
  /** Rocket's share of the widest figure in the row, as a percentage. */
  fill: number;
  against: string;
}

const stats: Stat[] = [
  {
    value: '146',
    unit: 'MB',
    label: 'Installed, unpacked',
    fill: 22,
    against: 'Bruno 527 MB · Postman 653 MB',
  },
  {
    value: '48.4',
    unit: 'MB',
    label: 'Download (.deb)',
    fill: 28,
    against: 'Postman 174 MB (snap)',
  },
  {
    value: '262',
    unit: 'MB',
    label: 'Idle memory, 3 processes',
    fill: 46,
    against: 'Bruno ~566 MB · Postman ~516 MB',
  },
  {
    value: '0',
    label: 'Accounts required',
    fill: 0,
    against: 'No sign-in, no sync, no telemetry',
  },
];

/**
 * The measured numbers, straight under the hero.
 * Each bar is Rocket's figure drawn against the largest of the three, so the
 * gap is legible before a single number is read.
 */
export function ProofStrip() {
  return (
    <section
      aria-labelledby="proof-heading"
      className="bg-primary text-primary-foreground"
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
        <h2 id="proof-heading" className="sr-only">
          Measured against Bruno and Postman
        </h2>

        <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="font-heading text-3xl leading-none font-semibold tracking-tighter tabular-nums sm:text-[2.25rem]">
                {stat.value}
                {stat.unit ? (
                  <span className="ml-1 text-lg font-medium opacity-70">{stat.unit}</span>
                ) : null}
              </p>
              <p className="mt-2.5 font-heading text-[11px] tracking-[0.14em] uppercase opacity-90">
                {stat.label}
              </p>
              <div
                aria-hidden="true"
                className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-primary-foreground/20"
              >
                <div
                  className="h-full rounded-full bg-primary-foreground"
                  style={{ width: `${stat.fill}%` }}
                />
              </div>
              <p className="mt-2.5 text-[11px] leading-snug opacity-85">{stat.against}</p>
            </div>
          ))}
        </div>

        <p className="mt-9 border-t border-primary-foreground/15 pt-5 text-[11px] leading-relaxed opacity-85">
          Measured 2026-10-21 on the same Linux machine — Rocket 2.1.1, Bruno 4.2.0, Postman
          11.71.7.{' '}
          <a
            href={`#${sections.benchmarks}`}
            className="font-medium underline underline-offset-4 opacity-100 transition-opacity hover:opacity-80"
          >
            See the full table, including the row Rocket loses.
          </a>
        </p>
      </div>
    </section>
  );
}
