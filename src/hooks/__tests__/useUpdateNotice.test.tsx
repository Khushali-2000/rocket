import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getInstallKind: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
}));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/tauri-api', () => api);
vi.mock('sonner', () => ({ toast: sonner }));
vi.mock('@/components/updates/UpdateToast', () => ({
  UPDATE_TOAST_ID: 'rocket-update',
  UpdateToast: () => null,
}));

import { resetAnnouncedUpdates, useUpdateNotice } from '../useUpdateNotice';
import { useUpdateStore } from '@/stores/update-store';

const info = (version: string) => ({ version, notes: null, date: null });

describe('useUpdateNotice', () => {
  let available: (i: ReturnType<typeof info>) => void = () => undefined;
  let progress: (p: { downloaded: number; total: number | null }) => void = () => undefined;
  const unlistenA = vi.fn();
  const unlistenP = vi.fn();

  beforeEach(() => {
    useUpdateStore.getState().reset();
    resetAnnouncedUpdates();
    sonner.custom.mockReset();
    unlistenA.mockReset();
    unlistenP.mockReset();
    api.getInstallKind.mockReset().mockResolvedValue('manual');
    api.onUpdateAvailable.mockReset().mockImplementation((h) => {
      available = h;
      return Promise.resolve(unlistenA);
    });
    api.onUpdateProgress.mockReset().mockImplementation((h) => {
      progress = h;
      return Promise.resolve(unlistenP);
    });
  });

  it('registers listeners, announces each version once and unlistens', async () => {
    const { unmount } = renderHook(() => useUpdateNotice());
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getInstallKind).toHaveBeenCalledTimes(1);
    expect(api.onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(api.onUpdateProgress).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().installKind).toBe('manual');

    act(() => available(info('2.2.0')));
    expect(useUpdateStore.getState().available?.version).toBe('2.2.0');
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    expect(sonner.custom).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: 'rocket-update' }),
    );

    act(() => available(info('2.2.0')));
    expect(sonner.custom).toHaveBeenCalledTimes(1);

    act(() => available(info('2.3.0')));
    expect(sonner.custom).toHaveBeenCalledTimes(2);

    act(() => progress({ downloaded: 5, total: 10 }));
    expect(useUpdateStore.getState().progress).toEqual({ downloaded: 5, total: 10 });
    expect(sonner.custom).toHaveBeenCalledTimes(3);
    expect(sonner.custom).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: 'rocket-update' }),
    );

    unmount();
    expect(unlistenA).toHaveBeenCalledTimes(1);
    expect(unlistenP).toHaveBeenCalledTimes(1);
  });
});
