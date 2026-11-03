import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ installUpdate: vi.fn(), skipUpdateVersion: vi.fn() }));
const sonner = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));

import { installAvailableUpdate, skipAvailableUpdate, useUpdateStore } from '../update-store';

const state = () => useUpdateStore.getState();
const info = { version: '2.2.0', notes: null, date: null };

describe('update store', () => {
  beforeEach(() => {
    state().reset();
    api.installUpdate.mockReset();
    api.skipUpdateVersion.mockReset();
    sonner.error.mockReset();
  });

  it('has the expected initial state', () => {
    expect(state().available).toBeNull();
    expect(state().installKind).toBe('selfUpdatable');
    expect(state().status).toBe('idle');
    expect(state().progress).toBeNull();
    expect(state().error).toBeNull();
    expect(state().dialogOpen).toBe(false);
  });

  it('stores the available update and resets', () => {
    state().setAvailable(info);
    state().openDialog();
    expect(state().available).toEqual(info);
    expect(state().dialogOpen).toBe(true);
    state().reset();
    expect(state().available).toBeNull();
    expect(state().dialogOpen).toBe(false);
  });

  it('goes downloading then ready on a good install', async () => {
    api.installUpdate.mockResolvedValue(undefined);
    state().setAvailable(info);
    const run = installAvailableUpdate();
    expect(state().status).toBe('downloading');
    await run;
    expect(api.installUpdate).toHaveBeenCalledWith('2.2.0');
    expect(state().status).toBe('ready');
  });

  it('sets the error and keeps the update on a failed install', async () => {
    api.installUpdate.mockRejectedValue(new Error('boom'));
    state().setAvailable(info);
    await installAvailableUpdate();
    expect(state().status).toBe('error');
    expect(state().error).toBe('boom');
    expect(state().available).toEqual(info);
  });

  it('skips a version and clears the update', async () => {
    api.skipUpdateVersion.mockResolvedValue(undefined);
    state().setAvailable(info);
    await skipAvailableUpdate();
    expect(api.skipUpdateVersion).toHaveBeenCalledWith('2.2.0');
    expect(state().available).toBeNull();
  });

  it('starts one install for two fast calls', async () => {
    api.installUpdate.mockResolvedValue(undefined);
    state().setAvailable(info);
    await Promise.all([installAvailableUpdate(), installAvailableUpdate()]);
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('ignores a result for a version that is no longer shown', async () => {
    let resolve: () => void = () => undefined;
    api.installUpdate.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    state().setAvailable(info);
    const run = installAvailableUpdate();
    state().setAvailable({ ...info, version: '2.3.0' });
    state().setStatus('idle');
    resolve();
    await run;
    expect(state().status).toBe('idle');
  });

  it('retries after an error', async () => {
    api.installUpdate.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
    state().setAvailable(info);
    await installAvailableUpdate();
    expect(state().status).toBe('error');
    await installAvailableUpdate();
    expect(state().status).toBe('ready');
    expect(state().error).toBeNull();
  });

  it('shows one error toast when saving the skip fails and still clears the update', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    api.skipUpdateVersion.mockRejectedValue(new Error('disk'));
    state().setAvailable(info);
    await skipAvailableUpdate();
    expect(sonner.error).toHaveBeenCalledTimes(1);
    expect(sonner.error).toHaveBeenCalledWith(
      'Could not save your choice',
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(state().available).toBeNull();
  });
});
