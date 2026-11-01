import { describe, expect, it } from 'vitest';
import type { Folder } from '@/lib/tauri-api';
import { countFolderContents, describeFolderContents } from '../folder-counts';

const request = (name: string) => ({ type: 'request' as const, uid: name, name }) as never;
const folder = (name: string, items: unknown[]) =>
  ({ type: 'folder' as const, uid: name, name, items }) as never;

describe('countFolderContents', () => {
  it('counts requests and subfolders at every depth', () => {
    const root = {
      uid: 'root',
      name: 'addresses',
      items: [request('a'), folder('sub', [request('b'), folder('deep', [request('c')])])],
    } as unknown as Folder;
    expect(countFolderContents(root)).toEqual({ requests: 3, folders: 2 });
  });

  it('returns zeros for an empty folder', () => {
    const root = { uid: 'r', name: 'x', items: [] } as unknown as Folder;
    expect(countFolderContents(root)).toEqual({ requests: 0, folders: 0 });
  });
});

describe('describeFolderContents', () => {
  it('uses singular and plural words', () => {
    expect(describeFolderContents({ requests: 1, folders: 1 })).toBe('1 request, 1 subfolder');
    expect(describeFolderContents({ requests: 12, folders: 3 })).toBe('12 requests, 3 subfolders');
  });

  it('says the folder is empty when there is nothing in it', () => {
    expect(describeFolderContents({ requests: 0, folders: 0 })).toBe('Empty folder');
  });
});
