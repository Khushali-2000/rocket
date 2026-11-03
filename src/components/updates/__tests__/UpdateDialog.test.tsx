import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ restartApp: vi.fn(), skipUpdateVersion: vi.fn() }));
const flow = vi.hoisted(() => ({ install: vi.fn(), skip: vi.fn() }));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));
const os = vi.hoisted(() => ({ platform: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => os);
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
    os.platform.mockReset().mockReturnValue('linux');
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
    // The last match is the footer button. The first is the sr-only X.
    const closes = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closes[closes.length - 1]);
    expect(state().dialogOpen).toBe(false);
  });

  it('shows the Windows note only for a self-update on Windows', () => {
    os.platform.mockReturnValue('windows');
    openWith();
    const { unmount } = render(<UpdateDialog />);
    expect(screen.getByText('Rocket will close to finish the update.')).toBeTruthy();
    unmount();
    os.platform.mockReturnValue('linux');
    render(<UpdateDialog />);
    expect(screen.queryByText('Rocket will close to finish the update.')).toBeNull();
  });

  it('hides the Windows note for a manual install', () => {
    os.platform.mockReturnValue('windows');
    state().setInstallKind('manual');
    openWith();
    render(<UpdateDialog />);
    expect(screen.queryByText('Rocket will close to finish the update.')).toBeNull();
  });

  it('disables Update and Skip while downloading', () => {
    openWith();
    state().setStatus('downloading');
    render(<UpdateDialog />);
    expect((screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Skip this version' }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
