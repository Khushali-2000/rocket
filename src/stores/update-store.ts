import { toast } from 'sonner';
import { create } from 'zustand';
import {
  type InstallKind,
  installUpdate,
  skipUpdateVersion,
  type UpdateInfo,
  type UpdateProgress,
} from '@/lib/tauri-api';

export type UpdateStatus = 'idle' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  available: UpdateInfo | null;
  installKind: InstallKind;
  status: UpdateStatus;
  progress: UpdateProgress | null;
  error: string | null;
  dialogOpen: boolean;
  setAvailable: (info: UpdateInfo | null) => void;
  setInstallKind: (kind: InstallKind) => void;
  setProgress: (progress: UpdateProgress | null) => void;
  setStatus: (status: UpdateStatus) => void;
  setError: (error: string | null) => void;
  openDialog: () => void;
  closeDialog: () => void;
  reset: () => void;
}

const initialState = {
  available: null as UpdateInfo | null,
  installKind: 'selfUpdatable' as InstallKind,
  status: 'idle' as UpdateStatus,
  progress: null as UpdateProgress | null,
  error: null as string | null,
  dialogOpen: false,
};

// State of the update notice. It is not saved.
export const useUpdateStore = create<UpdateState>()((set) => ({
  ...initialState,
  setAvailable: (available) =>
    set((s) =>
      // Clearing the update also clears an error, so the next update starts clean.
      available === null && s.status === 'error'
        ? { available, status: 'idle', error: null }
        : { available },
    ),
  setInstallKind: (installKind) => set({ installKind }),
  setProgress: (progress) => set({ progress }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  reset: () => set({ ...initialState }),
}));

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'The update failed.';
}

// Downloads and installs the available update.
export async function installAvailableUpdate(): Promise<void> {
  const first = useUpdateStore.getState();
  // A second click while a download runs must not start another install.
  if (first.status !== 'idle' && first.status !== 'error') return;
  const started = first.available;
  if (!started) return;
  first.setError(null);
  first.setProgress(null);
  first.setStatus('downloading');
  // A result counts only while the shown update is still the one that was started.
  const stillCurrent = () => useUpdateStore.getState().available?.version === started.version;
  try {
    await installUpdate(started.version);
    if (stillCurrent()) useUpdateStore.getState().setStatus('ready');
  } catch (e) {
    if (!stillCurrent()) return;
    const s = useUpdateStore.getState();
    s.setError(messageOf(e));
    s.setStatus('error');
  } finally {
    // A stale result must not leave the status stuck on downloading.
    const s = useUpdateStore.getState();
    if (!stillCurrent() && s.status === 'downloading') s.setStatus('idle');
  }
}

// Remembers the skipped version and hides the notice.
export async function skipAvailableUpdate(): Promise<void> {
  const { available } = useUpdateStore.getState();
  if (!available) return;
  try {
    await skipUpdateVersion(available.version);
  } catch (e) {
    console.warn('Could not save the skipped update version.', e);
    // A fixed id keeps this to one toast.
    toast.error('Could not save your choice', { id: 'rocket-update-skip-error' });
  }
  useUpdateStore.getState().setAvailable(null);
}
