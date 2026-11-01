import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderSettings } from '@/lib/tauri-api';

// CodeMirror does not run in jsdom, so the variable-aware field is replaced by a plain input.
vi.mock('@/components/editor', () => ({
  SingleLineEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/hooks/useFolderVariableContext', () => ({
  useFolderVariableContext: () => ({ variableContext: new Map(), environmentName: undefined }),
}));

const inherited = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/hooks/useInheritedHeaders', () => ({
  useInheritedHeaders: () => inherited.value,
}));

import { HeadersSection } from '../HeadersSection';

const settings = (patch: Record<string, unknown> = {}): FolderSettings =>
  ({
    headers: [],
    auth: null,
    variables: [],
    preRequestScript: null,
    postResponseScript: null,
    testsScript: null,
    docs: null,
    ...patch,
  }) as unknown as FolderSettings;

describe('HeadersSection', () => {
  beforeEach(() => {
    inherited.value = null;
  });

  it('shows the empty state and an Add header button when there are no headers', () => {
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No headers on this folder\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add header' })).toBeInTheDocument();
  });

  it('hides the empty state when a header is present', () => {
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({ headers: [{ key: 'X-A', value: '1', enabled: true }] })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/No headers on this folder\./)).not.toBeInTheDocument();
  });

  it('shows the folder headers', () => {
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({ headers: [{ key: 'X-A', value: '1', enabled: true }] })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Key for row 1')).toHaveValue('X-A');
  });

  it('editing a value keeps the header description', () => {
    const onChange = vi.fn();
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({
          headers: [{ key: 'X-A', value: '1', enabled: true, description: 'why' }],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({
      headers: [{ key: 'X-A', value: '2', enabled: true, description: 'why' }],
    });
  });

  it('a disabled header keeps enabled false', () => {
    const onChange = vi.fn();
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({ headers: [{ key: 'X-A', value: '1', enabled: false }] })}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({
      headers: [{ key: 'X-A', value: '2', enabled: false }],
    });
  });

  it('adding a blank row does not call onChange', () => {
    const onChange = vi.fn();
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add header/ }));
    expect(screen.getByLabelText('Key for row 1')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('naming a new row sends the header', () => {
    const onChange = vi.fn();
    render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add header/ }));
    fireEvent.change(screen.getByLabelText('Key for row 1'), { target: { value: 'X-New' } });
    expect(onChange).toHaveBeenLastCalledWith({
      headers: [{ key: 'X-New', value: '', enabled: true }],
    });
  });

  it('resets the rows when settings.headers changes from outside', () => {
    const { rerender } = render(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({ headers: [{ key: 'X-A', value: '1', enabled: true }] })}
        onChange={vi.fn()}
      />,
    );
    rerender(
      <HeadersSection
        collectionName='demo'
        folderPath='api'
        settings={settings({ headers: [{ key: 'X-Z', value: '9', enabled: true }] })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Key for row 1')).toHaveValue('X-Z');
  });

  it('shows inherited rows with their source and marks an overridden one', () => {
    inherited.value = {
      collection: {
        label: 'shop',
        headers: [
          { key: 'Accept', value: 'json', enabled: true },
          { key: 'X-Id', value: '1', enabled: true },
        ],
      },
      parents: [],
    };
    render(
      <HeadersSection
        collectionName='shop'
        folderPath='api'
        settings={settings({ headers: [{ key: 'Accept', value: 'xml', enabled: true }] })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Inherited headers')).toBeInTheDocument();
    expect(screen.getAllByText('shop')).toHaveLength(2);
    expect(screen.getByText('X-Id')).toBeInTheDocument();
    expect(screen.getAllByText('Overridden here')).toHaveLength(1);
  });

  it('keeps the empty state tied to the own headers when rows are inherited', () => {
    inherited.value = {
      collection: { label: 'shop', headers: [{ key: 'Accept', value: 'json', enabled: true }] },
      parents: [],
    };
    render(
      <HeadersSection
        collectionName='shop'
        folderPath='api'
        settings={settings()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No headers on this folder\./)).toBeInTheDocument();
  });
});
