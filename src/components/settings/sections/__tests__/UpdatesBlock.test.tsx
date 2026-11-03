import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getUpdateSettings: vi.fn(),
  setUpdateAutoCheck: vi.fn(),
  restartApp: vi.fn(),
}));
const flow = vi.hoisted(() => ({ install: vi.fn() }));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() }));
const app = vi.hoisted(() => ({ getVersion: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));
vi.mock('@tauri-apps/api/app', () => app);
const os = vi.hoisted(() => ({ platform: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => os);
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@/stores/update-store', async () => {
  const actual = await vi.importActual<typeof import('@/stores/update-store')>(
    '@/stores/update-store',
  );
  return { ...actual, installAvailableUpdate: flow.install };
});

import { useUpdateStore } from '@/stores/update-store';
import { UpdatesBlock } from '../UpdatesBlock';

const state = () => useUpdateStore.getState();
const info = { version: '2.2.0', notes: null, date: null };

describe('UpdatesBlock', () => {
  beforeEach(() => {
    state().reset();
    for (const m of [...Object.values(api), ...Object.values(flow), ...Object.values(sonner)]) {
      m.mockReset();
    }
    os.platform.mockReset().mockReturnValue('linux');
    app.getVersion.mockReset().mockResolvedValue('2.1.0');
    api.getUpdateSettings.mockResolvedValue({ autoCheck: true, skippedVersion: null });
    api.setUpdateAutoCheck.mockResolvedValue(undefined);
  });

  it('shows the current version and Up to date', async () => {
    render(<UpdatesBlock />);
    expect(await screen.findByText(/current 2\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/Up to date/)).toBeTruthy();
  });

  it('reflects the auto-check setting and toggles it', async () => {
    render(<UpdatesBlock />);
    const sw = await screen.findByRole('switch');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    expect(api.setUpdateAutoCheck).toHaveBeenCalledWith(false);
  });

  it('Check now shows Checking... then the latest message', async () => {
    let resolve: (v: null) => void = () => undefined;
    api.checkForUpdate.mockReturnValue(new Promise<null>((r) => (resolve = r)));
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(screen.getByRole('button', { name: 'Checking...' })).toBeTruthy();
    resolve(null);
    expect(await screen.findByText('You are on the latest version')).toBeTruthy();
  });

  it('Check now shows the update with Update and View release', async () => {
    api.checkForUpdate.mockResolvedValue(info);
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Rocket 2\.2\.0 is available/)).toBeTruthy();
    expect(state().available).toEqual(info);
    expect(screen.getByRole('button', { name: 'View release' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(flow.install).toHaveBeenCalledTimes(1);
  });

  it('a failed check shows an inline message and no toast', async () => {
    api.checkForUpdate.mockRejectedValue(new Error('net'));
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Could not check for updates.')).toBeTruthy();
    expect(sonner.error).not.toHaveBeenCalled();
    expect(sonner.custom).not.toHaveBeenCalled();
  });

  it('shows the Update action for an update already in the store', () => {
    state().setAvailable(info);
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(flow.install).toHaveBeenCalledTimes(1);
  });

  it('a skipped version still shows after a manual check', async () => {
    api.getUpdateSettings.mockResolvedValue({ autoCheck: true, skippedVersion: '2.2.0' });
    api.checkForUpdate.mockResolvedValue(info);
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Rocket 2\.2\.0 is available/)).toBeTruthy();
  });

  it('rolls the switch back and shows a message when saving fails', async () => {
    api.setUpdateAutoCheck.mockRejectedValue(new Error('no'));
    render(<UpdatesBlock />);
    const sw = await screen.findByRole('switch');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    expect(await screen.findByText('Could not save the setting.')).toBeTruthy();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    api.setUpdateAutoCheck.mockResolvedValue(undefined);
    fireEvent.click(sw);
    await waitFor(() => expect(screen.queryByText('Could not save the setting.')).toBeNull());
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('a late failure of an older toggle does not restore a stale value', async () => {
    let fail: (e: Error) => void = () => undefined;
    api.setUpdateAutoCheck
      .mockReturnValueOnce(new Promise<void>((_, rej) => (fail = rej)))
      .mockResolvedValueOnce(undefined);
    render(<UpdatesBlock />);
    const sw = await screen.findByRole('switch');
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sw);
    fireEvent.click(sw);
    fail(new Error('no'));
    await waitFor(() => expect(api.setUpdateAutoCheck).toHaveBeenCalledTimes(2));
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Could not save the setting.')).toBeNull();
  });

  it('a null check clears a stale idle update and says latest', async () => {
    state().setAvailable(info);
    api.checkForUpdate.mockResolvedValue(null);
    render(<UpdatesBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('You are on the latest version')).toBeTruthy();
    expect(state().available).toBeNull();
  });

  it('a null check keeps the update while downloading or ready', async () => {
    api.checkForUpdate.mockResolvedValue(null);
    for (const st of ['downloading', 'ready'] as const) {
      state().reset();
      state().setAvailable(info);
      state().setStatus(st);
      const { unmount } = render(<UpdatesBlock />);
      fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
      expect(await screen.findByText('You are on the latest version')).toBeTruthy();
      expect(state().available).toEqual(info);
      expect(state().status).toBe(st);
      unmount();
    }
  });

  it('shows the Windows note only for a self-update on Windows', () => {
    os.platform.mockReturnValue('windows');
    state().setAvailable(info);
    const { unmount } = render(<UpdatesBlock />);
    expect(screen.getByText('Rocket will close to finish the update.')).toBeTruthy();
    unmount();
    os.platform.mockReturnValue('linux');
    render(<UpdatesBlock />);
    expect(screen.queryByText('Rocket will close to finish the update.')).toBeNull();
  });

  it('hides the Windows note for a manual install', () => {
    os.platform.mockReturnValue('windows');
    state().setInstallKind('manual');
    state().setAvailable(info);
    render(<UpdatesBlock />);
    expect(screen.queryByText('Rocket will close to finish the update.')).toBeNull();
  });

  it('disables Update while downloading', () => {
    state().setAvailable(info);
    state().setStatus('downloading');
    render(<UpdatesBlock />);
    expect((screen.getByRole('button', { name: 'Downloading...' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
