import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ restartApp: vi.fn(), skipUpdateVersion: vi.fn() }));
const flow = vi.hoisted(() => ({ install: vi.fn(), skip: vi.fn() }));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'linux') }));
vi.mock('@tauri-apps/plugin-opener', () => opener);
vi.mock('@/stores/update-store', async () => {
  const actual = await vi.importActual<typeof import('@/stores/update-store')>(
    '@/stores/update-store',
  );
  return { ...actual, installAvailableUpdate: flow.install, skipAvailableUpdate: flow.skip };
});

import { useUpdateStore } from '@/stores/update-store';
import { UpdateDialog } from '../UpdateDialog';

const state = () => useUpdateStore.getState();
const info = {
  version: '2.2.0',
  notes: '## Fixes\n\nSomething.\n\n<script>alert(1)</script>\n\n![x](https://evil/x.png)',
  date: '2026-11-01',
};

describe('UpdateDialog', () => {
  beforeEach(() => {
    state().reset();
    for (const m of [
      ...Object.values(api),
      ...Object.values(flow),
      ...Object.values(sonner),
      ...Object.values(opener),
    ]) {
      m.mockReset();
    }
    opener.openUrl.mockResolvedValue(undefined);
  });

  const openWith = (patch: object = {}) => {
    state().setAvailable({ ...info, ...patch });
    state().openDialog();
  };

  it('is closed when dialogOpen is false', () => {
    state().setAvailable(info);
    render(<UpdateDialog />);
    expect(screen.queryByText('Rocket 2.2.0')).toBeNull();
  });

  it('shows the version, the date and the restricted notes', () => {
    openWith();
    render(<UpdateDialog />);
    expect(screen.getByText('Rocket 2.2.0')).toBeTruthy();
    expect(screen.getByText('2026-11-01')).toBeTruthy();
    expect(screen.getByText('[image omitted: x]')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows No release notes. for empty notes', () => {
    openWith({ notes: null });
    render(<UpdateDialog />);
    expect(screen.getByText('No release notes.')).toBeTruthy();
  });

  it('Update runs the install flow', () => {
    openWith();
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(flow.install).toHaveBeenCalledTimes(1);
  });

  it('Skip skips and closes', () => {
    openWith();
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(flow.skip).toHaveBeenCalledTimes(1);
    expect(state().dialogOpen).toBe(false);
  });

  it('Close closes', () => {
    openWith();
    render(<UpdateDialog />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(state().dialogOpen).toBe(false);
  });

  it('shows View release for a manual install', () => {
    state().setInstallKind('manual');
    openWith();
    render(<UpdateDialog />);
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View release' }));
    expect(opener.openUrl).toHaveBeenCalledWith(expect.stringContaining('v2.2.0'));
  });

  it('shows Restart when ready', () => {
    openWith();
    state().setStatus('ready');
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(api.restartApp).toHaveBeenCalledTimes(1);
  });
});
