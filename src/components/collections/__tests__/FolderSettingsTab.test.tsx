import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderSettingsTab } from '@/components/collections/FolderSettingsTab';
import { collectAllTabs } from '@/lib/pane-utils';
import { getCollection } from '@/lib/tauri-api';
import { usePaneStore } from '@/stores/pane-store';
import type { FolderTab } from '@/types/pane-types';
import { isFolderTab } from '@/types/pane-types';

vi.mock('@/lib/auto-save', () => ({ scheduleAutoSave: vi.fn() }));
// The sections read environments through react-query, which this test does not provide.
vi.mock('@/hooks/useFolderVariableContext', () => ({
  useFolderVariableContext: () => ({ variableContext: new Map(), environmentName: undefined }),
}));
vi.mock('@/lib/tauri-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri-api')>('@/lib/tauri-api');
  return {
    ...actual,
    getCollection: vi.fn(),
    endAgentSession: vi.fn(),
    getFolderSettings: vi.fn().mockResolvedValue({ headers: [], variables: [] }),
    saveFolderSettings: vi.fn().mockResolvedValue(undefined),
  };
});

const req = (name: string) => ({ type: 'request', uid: name, name });

// A small tree with the folder auth/oauth holding 3 requests and 1 subfolder.
const sampleCollection = {
  name: 'my-col',
  settings: {},
  root: {
    uid: 'root',
    name: 'my-col',
    items: [
      {
        type: 'folder',
        uid: 'auth',
        name: 'auth',
        items: [
          {
            type: 'folder',
            uid: 'oauth',
            name: 'oauth',
            items: [
              req('login'),
              req('refresh'),
              req('logout'),
              { type: 'folder', uid: 'tokens', name: 'tokens', items: [] },
            ],
          },
        ],
      },
    ],
  },
};

function storedTab(): FolderTab {
  const tab = collectAllTabs(usePaneStore.getState().root).find(isFolderTab);
  if (!tab) throw new Error('No folder tab in the store');
  return tab;
}

const unsubscribers: Array<() => void> = [];

// The tab reads its section from the store, so the test re-renders with the stored tab.
// The subscription is released in afterEach, so one failing test cannot leak into the next.
async function renderStoredTab() {
  const view = render(<FolderSettingsTab tab={storedTab()} />);
  unsubscribers.push(
    usePaneStore.subscribe(() => {
      view.rerender(<FolderSettingsTab tab={storedTab()} />);
    }),
  );
  await screen.findAllByRole('tab');
  return view;
}

describe('FolderSettingsTab', () => {
  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(getCollection).mockResolvedValue(sampleCollection as never);
    usePaneStore.getState().reset();
    usePaneStore.getState().openFolderTab('my-col', 'auth/oauth');
  });

  it('shows the folder name and the contents summary', async () => {
    await renderStoredTab();
    expect(screen.getByRole('heading', { name: 'oauth' })).toBeInTheDocument();
    expect(await screen.findByText('3 requests, 1 subfolder')).toBeInTheDocument();
  });

  it('shows no summary and does not crash when the collection fails to load', async () => {
    vi.mocked(getCollection).mockRejectedValue(new Error('load failed'));
    await renderStoredTab();
    expect(screen.getByRole('heading', { name: 'oauth' })).toBeInTheDocument();
    await waitFor(() => expect(getCollection).toHaveBeenCalled());
    expect(screen.queryByText(/requests?, \d+ subfolders?/)).not.toBeInTheDocument();
  });

  it('shows the six sections in order', async () => {
    await renderStoredTab();
    const labels = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(labels).toEqual(['Headers', 'Script', 'Test', 'Vars', 'Auth', 'Docs']);
    expect(screen.getByRole('tab', { name: 'Headers' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the body of the active section', async () => {
    usePaneStore.getState().openFolderTab('my-col', 'auth/oauth', 'docs');
    await renderStoredTab();
    expect(screen.getByRole('tab', { name: 'Docs' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No documentation yet')).toBeInTheDocument();
  });

  it('switching a section updates the tab in the store', async () => {
    await renderStoredTab();
    await userEvent.click(screen.getByRole('tab', { name: 'Auth' }));
    expect(storedTab().activeSection).toBe('auth');
    expect(screen.getByRole('tab', { name: 'Auth' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/No authorization is set on this folder/)).toBeInTheDocument();
  });
});
