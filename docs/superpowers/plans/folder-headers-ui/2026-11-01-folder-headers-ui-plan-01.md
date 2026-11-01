# Folder Headers UI — Plan 01: Header block, empty state, inherited headers

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the folder settings page on the Headers tab: a header block without the duplicate path, a clearer Save button, a helpful empty state, and read-only inherited headers with a source chip.

**Scope:** Headers tab and the page header only. Vars, Auth and Script tabs are out of scope. The pill tab strip (`ui/tabs.tsx`) stays as it is. `HeadersEditor` and `KeyValueEditor` are shared with other screens, so they are only called with new props and never restyled.

**Architecture:** Frontend only, no new IPC command. A pure helper merges inherited headers per level and flags the ones this folder overrides. A hook loads the levels with `getCollectionSettings`, `ancestorFolderPaths` and `getFolderSettings`. A presentational component renders the rows above the editor.

**Tech Stack:** React, TypeScript, shadcn/ui, lucide-react, Zustand, Vitest. Package manager: Bun.

**Evidence (from the investigation):**
- Header block and subtitle: `src/components/collections/FolderSettingsTab.tsx:63-79` (subtitle at :69). Used by this page only.
- Save button: `src/components/collections/folder-settings/FolderSaveButton.tsx:23-37`. The unsaved dot and text already exist (:17-22), so they are not added here.
- Headers body: `src/components/collections/folder-settings/HeadersSection.tsx:40-47`. There is no empty-state branch.
- Shared editor label: `src/components/request/HeadersEditor.tsx:24` (`addLabel='Add Header'`). Four screens use `HeadersEditor`.
- Inheritance helpers: `src/lib/folder-inheritance.ts:4-45`. `inheritedHeaders` compares names without case, but the backend compares them exactly, so this plan adds its own exact-match helper and does not reuse it for the "overrides" flag.
- Per-level data: `getCollectionSettings` (`src/lib/tauri-api.ts:1019`) and `getFolderSettings` (`src/lib/tauri-api.ts:1783`).

**Depends on:** nothing.

**Out of scope, on purpose:**
- Parent-folder edits that are not saved yet do not show. Only saved `folder.yml` is read. The UI says so.
- No cache. Each tab open reads one collection and one folder per ancestor.

---

### Task 1: Header block and Save button

📖 Frontend only. No yml or IPC change.

**Files:**
- Modify: `src/components/collections/FolderSettingsTab.tsx`
- Modify: `src/components/collections/folder-settings/FolderSaveButton.tsx`
- Create: `src/lib/folder-counts.ts`
- Create: `src/lib/__tests__/folder-counts.test.ts`
- Modify: `src/lib/runner-flatten.ts` (export `findFolder` only)

- [ ] **Step 1: Find where the loaded collection tree comes from**

`CollectionOverviewTab.tsx` already shows a stats line for a collection, so a loaded `Collection` is reachable from the pane. Open `CollectionOverviewTab.tsx:331-340` and find the selector or hook it uses. Reuse that same source in `FolderSettingsTab`. If the tree is not loaded for this tab, drop the counts and keep only the folder name (see Step 5).

- [ ] **Step 2: Write the failing count tests**

Create `src/lib/__tests__/folder-counts.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `bun run test folder-counts`
Expected: FAIL, module `../folder-counts` not found.

- [ ] **Step 4: Implement the helper**

Export `findFolder` from `src/lib/runner-flatten.ts` (add the `export` keyword, no other change). Create `src/lib/folder-counts.ts`:

```typescript
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
```

- [ ] **Step 5: Use it in the header block**

In `FolderSettingsTab.tsx`:
1. Remove the `breadcrumb` constant (line 25) and its `<p>` at line 69.
2. Get the `Collection` from the source found in Step 1. Compute the summary with `findFolder(collection.root, '', tab.folderPath)`, then `describeFolderContents(countFolderContents(found))`, inside `useMemo`. If `found` is null or the tree is not loaded, render no subtitle.
3. Render the summary in the same `<p className='truncate text-xs text-muted-foreground'>` slot.

If Step 1 found no tree for this tab, delete the `<p>` and skip the helper. Then remove the new files and say so in the ledger.

- [ ] **Step 6: Make the disabled Save button read as disabled**

In `FolderSaveButton.tsx`, use `variant='outline'` while `!isDirty` and the default variant once dirty, so the clean state is a quiet outline and the dirty state is the one primary action:

```tsx
<Button
  size='sm'
  variant={isDirty ? 'default' : 'outline'}
  onClick={onSave}
  disabled={!isLoaded || !isDirty || saveState !== 'idle'}
  className={cn('gap-1.5', saveState === 'success' && 'text-green-600')}
>
```

Keep the `saveState === 'saving'` and `'success'` behaviour as it is. While saving, `isDirty` is still true, so the button keeps the primary look.

- [ ] **Step 7: Verify**

Run: `bun run test folder-counts`, `bunx tsc --noEmit`, `bun run check`
Expected: all pass. Open a folder tab with `bun run tauri dev` and confirm the subtitle shows counts, the path appears once (breadcrumb bar only), and Save is outlined when clean and filled after an edit.

---

### Task 2: Headers body and empty state

**Files:**
- Modify: `src/components/request/HeadersEditor.tsx` (optional prop `addLabel`, default unchanged)
- Modify: `src/components/request/KeyValueEditor.tsx` only if it has no way to hide its own add button (see Step 1)
- Modify: `src/components/collections/folder-settings/HeadersSection.tsx`
- Create: `src/components/collections/folder-settings/__tests__/HeadersSection.test.tsx`

- [ ] **Step 1: Check what `KeyValueEditor` renders with zero rows**

Read `src/components/request/KeyValueEditor.tsx:21` and note how it renders zero rows and where the add button sits. The other seven screens use it, so do not change default output. Only add optional props, and only if needed.

- [ ] **Step 2: Write the failing test**

Create `src/components/collections/folder-settings/__tests__/HeadersSection.test.tsx` with one test that renders `HeadersSection` with `settings.headers = []` and expects the text `No headers on this folder.` and a button named `Add header`, and one test with a header present that expects the empty text to be absent. Mock `useFolderVariableContext` and the Task 3 hook the way other tests in `src/components/collections/__tests__` mock hooks.

- [ ] **Step 3: Run the test and confirm it fails**

Run: `bun run test HeadersSection`
Expected: FAIL, empty text not found.

- [ ] **Step 4: Add the optional label prop**

In `HeadersEditor.tsx` add `addLabel?: string` to the props and pass `addLabel={addLabel ?? 'Add Header'}`. The other three callers keep the old label.

- [ ] **Step 5: Update `HeadersSection.tsx`**

- Rewrite the description in plain words, keeping the meaning: "Sent with every request in this folder and its subfolders. A request or a nearer folder replaces a header with the same name."
- Use `text-sm text-muted-foreground max-w-[70ch]` for the description, so the contrast and line length improve without a new colour token.
- When `entries.length === 0`, render above the editor: `No headers on this folder. Add one to send it with every request below.` in the same muted style.
- Pass `addLabel='Add header'`.

- [ ] **Step 6: Verify**

Run: `bun run test HeadersSection`, `bunx tsc --noEmit`, `bun run check`
Expected: all pass. Check the other three `HeadersEditor` screens in the app still say "Add Header".

---

### Task 3: Inherited headers, read-only

📖 Before starting, read `docs/superpowers/specs/opencollection-spec-reference.md`.

**Files:**
- Create: `src/lib/folder-header-inheritance.ts`
- Create: `src/lib/__tests__/folder-header-inheritance.test.ts`
- Create: `src/hooks/useInheritedHeaders.ts`
- Create: `src/components/collections/folder-settings/InheritedHeadersList.tsx`
- Modify: `src/components/collections/folder-settings/HeadersSection.tsx`

- [ ] **Step 1: Write the failing tests for the merge helper**

Create `src/lib/__tests__/folder-header-inheritance.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildInheritedHeaderRows } from '../folder-header-inheritance';

const h = (key: string, value: string, enabled = true) => ({ key, value, enabled });

describe('buildInheritedHeaderRows', () => {
  it('lists collection headers first, then each folder outermost first', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('X-Team', 'a')] }],
      [],
    );
    expect(rows.map((r) => [r.key, r.source])).toEqual([
      ['Accept', 'shop'],
      ['X-Team', 'users'],
    ]);
  });

  it('lets a nearer level replace a header with the same name', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('Accept', 'xml')] }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'Accept', value: 'xml', source: 'users' });
  });

  it('drops disabled headers and never lets them shadow', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('Accept', 'xml', false)] }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 'json', source: 'shop' });
  });

  it('marks a row overridden only on an exact, case-sensitive name match', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json'), h('X-Id', '1')] },
      [],
      [h('Accept', 'xml'), h('x-id', '2')],
    );
    expect(rows.find((r) => r.key === 'Accept')?.overridden).toBe(true);
    expect(rows.find((r) => r.key === 'X-Id')?.overridden).toBe(false);
  });

  it('ignores disabled own headers when marking overrides', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [],
      [h('Accept', 'xml', false)],
    );
    expect(rows[0]?.overridden).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run test folder-header-inheritance`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/folder-header-inheritance.ts`:

```typescript
import type { Header } from '@/lib/tauri-api';

export interface HeaderLevel {
  label: string;
  headers: Header[];
}

export interface InheritedHeaderRow {
  key: string;
  value: string;
  source: string;
  overridden: boolean;
}

// Builds the read-only inherited rows for a folder. Collection headers come first, then
// each parent folder outermost first. A nearer level replaces a header with the same name.
// Names compare exactly, like the Rust merge. Disabled headers never shadow and are dropped.
export function buildInheritedHeaderRows(
  collection: HeaderLevel,
  parents: HeaderLevel[],
  ownHeaders: Header[],
): InheritedHeaderRow[] {
  let merged: { key: string; value: string; source: string }[] = [];
  for (const level of [collection, ...parents]) {
    const own = level.headers
      .filter((header) => header.enabled)
      .map((header) => ({ key: header.key, value: header.value, source: level.label }));
    const names = new Set(own.map((row) => row.key));
    merged = [...merged.filter((row) => !names.has(row.key)), ...own];
  }
  const ownNames = new Set(ownHeaders.filter((header) => header.enabled).map((h) => h.key));
  return merged.map((row) => ({ ...row, overridden: ownNames.has(row.key) }));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run test folder-header-inheritance`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the hook**

Create `src/hooks/useInheritedHeaders.ts`. Follow the `useEffect` plus `useState` shape of `src/hooks/useFolderVariableContext.ts:38-42`:

```typescript
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
```

Check `getCollectionSettings(...).headers` against the type at `src/lib/tauri-api.ts:1019` and adjust the field access if the name differs.

- [ ] **Step 6: Write the list component**

Create `src/components/collections/folder-settings/InheritedHeadersList.tsx`. Use shadcn `Badge` for the source chip and `lucide-react` `CornerLeftUp` (or another existing lucide icon) for the "inherited" cue. Do not use raw `<button>`, `<input>` or `<table>` controls beyond what the app already uses for read-only lists. Behaviour:
- Props: `rows: InheritedHeaderRow[]`.
- Render nothing when `rows.length === 0`.
- A short heading `Inherited headers` and one muted line: `Read-only. Edit them in the folder or collection they come from. Unsaved changes there are not shown yet.`
- One row per header: name, value, source chip. An overridden row gets `line-through` and `opacity-60` on the name and value, plus the text `Overridden here`.
- Row text uses the same mono face and size as the editor rows. Reuse tokens from `docs/features/elevation.md` for the surface, and add no new colour.

- [ ] **Step 7: Wire it into `HeadersSection.tsx`**

```tsx
const levels = useInheritedHeaders(collectionName, folderPath);
const inheritedRows = useMemo(
  () =>
    levels
      ? buildInheritedHeaderRows(levels.collection, levels.parents, settings.headers ?? [])
      : [],
  [levels, settings.headers],
);
```

Render `<InheritedHeadersList rows={inheritedRows} />` above the `HeadersEditor`, followed by a small `This folder` heading only when the inherited list is not empty. The overridden flag follows `settings.headers`, so it updates as the user types.

- [ ] **Step 8: Verify**

Run: `bun run test folder-header-inheritance HeadersSection`, `bunx tsc --noEmit`, `bun run check`
Expected: all pass. In `bun run tauri dev`, use a collection with a collection-level header and a nested folder:
1. Open the nested folder. The collection header shows with the collection chip.
2. Add a header with the same name in the parent folder, save it, and reopen the nested folder. The parent's value shows with the parent chip.
3. Add the same name in the nested folder. The inherited row dims and shows `Overridden here`.
4. Open a top-level folder in a collection with no headers. No inherited block shows.

---

## Final checks before merge

- [ ] `bunx tsc --noEmit`, `bun run check`, `bun run test` for the touched files, all green.
- [ ] Three other `HeadersEditor` screens (request, WebSocket, collection Default Headers) still say "Add Header" and look unchanged.
- [ ] Update `docs/features/folder-settings.md` with the header summary line, the empty state and the inherited headers list, including the two known limits (saved values only, one read per ancestor).
