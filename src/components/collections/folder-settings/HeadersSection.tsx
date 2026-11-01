import { useEffect, useMemo, useState } from 'react';
import { HeadersEditor } from '@/components/request/HeadersEditor';
import { useFolderVariableContext } from '@/hooks/useFolderVariableContext';
import { useInheritedHeaders } from '@/hooks/useInheritedHeaders';
import { buildInheritedHeaderRows } from '@/lib/folder-header-inheritance';
import { entriesToHeaders, headersToEntries } from '@/lib/folder-settings-convert';
import type { KeyValueEntry } from '@/types/pane-types';
import { InheritedHeadersList } from './InheritedHeadersList';
import type { FolderSectionProps } from './sections';

export function HeadersSection({
  collectionName,
  folderPath,
  settings,
  onChange,
}: FolderSectionProps) {
  // Rows live here, not in `settings`, so a row with no name yet is not dropped on the
  // next render. Only complete rows are pushed up.
  const [entries, setEntries] = useState<KeyValueEntry[]>(() => headersToEntries(settings.headers));
  const { variableContext } = useFolderVariableContext(
    collectionName,
    folderPath,
    settings.variables,
  );
  const levels = useInheritedHeaders(collectionName, folderPath);
  const inheritedRows = useMemo(
    () =>
      levels
        ? buildInheritedHeaderRows(levels.collection, levels.parents, settings.headers ?? [])
        : [],
    [levels, settings.headers],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change to settings.headers resets the rows; the local rows are compared inside.
  useEffect(() => {
    if (
      JSON.stringify(entriesToHeaders(entries, settings.headers)) !==
      JSON.stringify(settings.headers)
    ) {
      setEntries(headersToEntries(settings.headers));
    }
  }, [settings.headers]);

  const handleChange = (next: KeyValueEntry[]) => {
    setEntries(next);
    const headers = entriesToHeaders(next, settings.headers);
    if (JSON.stringify(headers) === JSON.stringify(settings.headers)) return;
    onChange({ headers });
  };

  return (
    <div className='p-4 max-w-3xl'>
      <p className='mb-3 text-sm text-muted-foreground max-w-[70ch]'>
        Sent with every request in this folder and its subfolders. A request or a nearer folder
        replaces a header with the same name.
      </p>
      <InheritedHeadersList rows={inheritedRows} />
      {entries.length === 0 && (
        <p className='mb-3 text-sm text-muted-foreground max-w-[70ch]'>
          No headers on this folder. Add one to send it with every request below.
        </p>
      )}
      <HeadersEditor
        headers={entries}
        onChange={handleChange}
        variableContext={variableContext}
        addLabel='Add header'
      />
    </div>
  );
}
