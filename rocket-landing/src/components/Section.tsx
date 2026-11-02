import type { ReactNode } from 'react';

import { Reveal } from '@/components/Reveal';
import { cn } from '@/lib/utils';

interface SectionProps {
  id?: string;
  /** `muted` tints the band so neighbouring sections read apart. */
  tone?: 'default' | 'muted';
  /** Hairline rule along the top edge. On by default. */
  divided?: boolean;
  className?: string;
  children: ReactNode;
}

export function Section({
  id,
  tone = 'default',
  divided = true,
  className,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-16 py-20 sm:py-24 lg:py-32',
        divided && 'border-t border-border',
        tone === 'muted' && 'bg-muted/40',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>
    </section>
  );
}

/** The small monospace key above a heading, set like a line in a collection file. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-heading text-xs tracking-[0.22em] text-primary lowercase',
        className,
      )}
    >
      <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-primary" />
      {children}
    </p>
  );
}

interface SectionHeaderProps {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = 'left',
  className,
}: SectionHeaderProps) {
  return (
    <Reveal className={cn(align === 'center' && 'mx-auto max-w-3xl text-center', className)}>
      <Eyebrow className={align === 'center' ? 'justify-center' : undefined}>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-heading text-[1.6rem] leading-[1.16] font-semibold tracking-tight text-balance sm:text-[2.1rem] sm:leading-[1.14] lg:text-[2.5rem]">
        {title}
      </h2>
      {lede ? (
        <p
          className={cn(
            'mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg',
            align === 'center' ? 'mx-auto max-w-2xl' : 'max-w-2xl',
          )}
        >
          {lede}
        </p>
      ) : null}
    </Reveal>
  );
}
