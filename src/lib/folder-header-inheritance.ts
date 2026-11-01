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
