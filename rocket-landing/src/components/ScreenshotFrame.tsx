import { useState } from 'react';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

interface ScreenshotFrameProps {
  /** Path under `public/`. Falls back to the placeholder when the file is not there yet. */
  src: string;
  /** Describes the screenshot for anyone who cannot see it. */
  alt: string;
  /** Shown in the window title bar — keep it short, like a tab name. */
  title: string;
  /** Stands in for the screenshot until the real file lands. */
  illustration: ComponentType<{ className?: string }>;
  /** Shape of the placeholder box. A real screenshot keeps its own proportions. */
  aspect?: string;
  /** Set on the frame above the fold so the image is not deferred. */
  priority?: boolean;
  className?: string;
}

export function ScreenshotFrame({
  src,
  alt,
  title,
  illustration: Illustration,
  aspect = 'aspect-16/10',
  priority = false,
  className,
}: ScreenshotFrameProps) {
  const [failed, setFailed] = useState(false);
  const filename = src.split('/').pop() ?? src;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-lg',
        'transition-shadow duration-300 hover:shadow-xl',
        className,
      )}
    >
      {/* Window chrome. */}
      <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-destructive/60" />
          <span className="size-2.5 rounded-full bg-warning/60" />
          <span className="size-2.5 rounded-full bg-success/60" />
        </div>
        <p className="truncate font-heading text-[11px] tracking-wide text-muted-foreground">
          {title}
        </p>
      </div>

      {failed ? (
        <Placeholder Illustration={Illustration} filename={filename} aspect={aspect} />
      ) : (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="block h-auto w-full"
        />
      )}
    </div>
  );
}

function Placeholder({
  Illustration,
  filename,
  aspect,
}: {
  Illustration: ComponentType<{ className?: string }>;
  filename: string;
  aspect: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-4 bg-background px-6 py-10',
        aspect,
      )}
    >
      <Illustration className="h-24 w-24 opacity-90 sm:h-32 sm:w-32" />
      <div className="text-center">
        <p className="font-heading text-xs tracking-[0.18em] text-muted-foreground uppercase">
          Screenshot coming soon
        </p>
        <p className="mt-2 font-heading text-[11px] text-muted-foreground/70">
          public/screenshots/{filename}
        </p>
      </div>
    </div>
  );
}
