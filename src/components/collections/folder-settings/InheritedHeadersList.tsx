import { CornerLeftUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { InheritedHeaderRow } from '@/lib/folder-header-inheritance';
import { cn } from '@/lib/utils';

interface InheritedHeadersListProps {
  rows: InheritedHeaderRow[];
}

// Read-only list of the headers this folder receives from the collection and parent folders.
export function InheritedHeadersList({ rows }: InheritedHeadersListProps) {
  if (rows.length === 0) return null;
  return (
    <div className='mb-4'>
      <h3 className='text-sm font-medium'>Inherited headers</h3>
      <p className='mb-2 text-sm text-muted-foreground max-w-[70ch]'>
        Read-only. Edit them in the folder or collection they come from. Unsaved changes there are
        not shown yet.
      </p>
      <ul className='rounded-md border border-border bg-elevation-sunken divide-y divide-border'>
        {rows.map((row, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: headers may share names so index is needed for uniqueness
            key={`${row.source}:${row.key}:${index}`}
            className='flex items-center gap-2 px-3 py-1.5'
          >
            <CornerLeftUp className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
            <span
              className={cn(
                'font-mono text-xs font-medium',
                row.overridden && 'line-through opacity-60',
              )}
            >
              {row.key}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground',
                row.overridden && 'line-through opacity-60',
              )}
            >
              {row.value}
            </span>
            {row.overridden && (
              <span className='text-xs text-muted-foreground'>Overridden here</span>
            )}
            <Badge variant='secondary' className='shrink-0'>
              {row.source}
            </Badge>
          </li>
        ))}
      </ul>
      <h3 className='mt-4 text-sm font-medium'>This folder</h3>
    </div>
  );
}
