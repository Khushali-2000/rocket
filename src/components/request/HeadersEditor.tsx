import type { VariableScopeEntry, VariableSource } from '@/lib/url-variables';
import type { KeyValueEntry } from '@/types/pane-types';
import { KeyValueEditor } from './KeyValueEditor';

interface HeadersEditorProps {
  headers: KeyValueEntry[];
  onChange: (headers: KeyValueEntry[]) => void;
  variableContext?: Map<string, VariableScopeEntry>;
  onNavigateToSource?: (source: VariableSource | 'pathParam', key: string) => void;
  addLabel?: string;
}

export function HeadersEditor({
  headers,
  onChange,
  variableContext,
  onNavigateToSource,
  addLabel,
}: HeadersEditorProps) {
  return (
    <KeyValueEditor
      entries={headers}
      onChange={onChange}
      keyPlaceholder='Header name'
      valuePlaceholder='Value'
      addLabel={addLabel ?? 'Add Header'}
      variableContext={variableContext}
      onNavigateToSource={onNavigateToSource}
    />
  );
}
