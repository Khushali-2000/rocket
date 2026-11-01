import type { Folder } from '@/lib/tauri-api';

export interface FolderCounts {
  requests: number;
  folders: number;
}

// Item types that count as a request in the summary line.
const REQUEST_TYPES = new Set(['request', 'summary', 'graphql', 'websocket', 'grpc']);

// Counts requests and subfolders at every depth below a folder.
export function countFolderContents(folder: Folder): FolderCounts {
  const counts: FolderCounts = { requests: 0, folders: 0 };
  for (const item of folder.items) {
    if (item.type === 'folder') {
      const inner = countFolderContents(item);
      counts.folders += 1 + inner.folders;
      counts.requests += inner.requests;
    } else if (REQUEST_TYPES.has(item.type)) {
      counts.requests += 1;
    }
  }
  return counts;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Short summary line for the folder header, like "12 requests, 3 subfolders".
export function describeFolderContents({ requests, folders }: FolderCounts): string {
  if (requests === 0 && folders === 0) return 'Empty folder';
  return `${plural(requests, 'request')}, ${plural(folders, 'subfolder')}`;
}
