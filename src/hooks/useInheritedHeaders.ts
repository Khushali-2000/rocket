import { useEffect, useState } from 'react';
import type { HeaderLevel } from '@/lib/folder-header-inheritance';
import { ancestorFolderPaths } from '@/lib/folder-inheritance';
import { getCollectionSettings, getFolderSettings } from '@/lib/tauri-api';

interface InheritedLevels {
  collection: HeaderLevel;
  parents: HeaderLevel[];
}

// Loads the saved headers of the collection and of every folder above this one.
export function useInheritedHeaders(collectionName: string, folderPath: string) {
  const [levels, setLevels] = useState<InheritedLevels | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const collection = await getCollectionSettings(collectionName);
        const parents: HeaderLevel[] = [];
        // The folder itself is not an ancestor, so ask for a path one level below it.
        for (const path of ancestorFolderPaths(`${folderPath}/_`)) {
          if (path === folderPath) continue;
          try {
            const folder = await getFolderSettings(collectionName, path);
            parents.push({ label: path.split('/').pop() ?? path, headers: folder.headers ?? [] });
          } catch {
            // A folder that cannot be read is skipped. The send reports the error.
          }
        }
        if (!cancelled) {
          setLevels({
            collection: { label: collectionName, headers: collection.headers ?? [] },
            parents,
          });
        }
      } catch {
        if (!cancelled) setLevels(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionName, folderPath]);

  return levels;
}
