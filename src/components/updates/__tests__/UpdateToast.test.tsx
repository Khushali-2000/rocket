import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ restartApp: vi.fn(), skipUpdateVersion: vi.fn() }));
const flow = vi.hoisted(() => ({ install: vi.fn(), skip: vi.fn() }));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() }));
const os = vi.hoisted(() => ({ platform: vi.fn() }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));
vi.mock('@tauri-apps/plugin-os', () => os);
vi.mock('@tauri-apps/plugin-opener', () => opener);
vi.mock('@/stores/update-store', async () => {
  const actual = await vi.importActual<typeof import('@/stores/update-store')>(
    '@/stores/update-store',
  );
  return { ...actual, installAvailableUpdate: flow.install, skipAvailableUpdate: flow.skip };
});

import { useUpdateStore } from '@/stores/update-store';
import { UpdateToast } from '../UpdateToast';

const info = { version: '2.2.0', notes: null, date: null };
const state = () => useUpdateStore.getState();

describe('UpdateToast', () => {
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

  it('shows the actions and runs Update', () => {
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    expect(screen.getByText('Rocket 2.2.0 is available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip this version' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(flow.install).toHaveBeenCalledTimes(1);
  });

  it('Later only dismisses', () => {
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(sonner.dismiss).toHaveBeenCalledWith('rocket-update');
    expect(api.skipUpdateVersion).not.toHaveBeenCalled();
    expect(flow.skip).not.toHaveBeenCalled();
  });

  it('Skip skips and dismisses', () => {
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(flow.skip).toHaveBeenCalledTimes(1);
    expect(sonner.dismiss).toHaveBeenCalledWith('rocket-update');
  });

  it('opens the dialog from the text and from What\'s new', () => {
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    fireEvent.click(screen.getByText('Rocket 2.2.0 is available'));
    expect(state().dialogOpen).toBe(true);
    state().closeDialog();
    fireEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(state().dialogOpen).toBe(true);
  });

  it('shows View release for a manual install', () => {
    render(<UpdateToast info={info} installKind='manual' />);
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View release' }));
    expect(opener.openUrl).toHaveBeenCalledWith(expect.stringContaining('v2.2.0'));
  });

  it('shows progress and no buttons while downloading', () => {
    state().setStatus('downloading');
    state().setProgress({ downloaded: 5, total: 10 });
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
  });

  it('shows Restart when ready', () => {
    state().setStatus('ready');
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(api.restartApp).toHaveBeenCalledTimes(1);
  });

  it('shows the error and View release', () => {
    state().setStatus('error');
    state().setError('boom');
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View release' })).toBeTruthy();
  });

  it('shows the Windows note only on Windows', () => {
    const { unmount } = render(<UpdateToast info={info} installKind='selfUpdatable' />);
    expect(screen.queryByText('Rocket will close to finish the update.')).toBeNull();
    unmount();
    os.platform.mockReturnValue('windows');
    render(<UpdateToast info={info} installKind='selfUpdatable' />);
    expect(screen.getByText('Rocket will close to finish the update.')).toBeTruthy();
  });
});
