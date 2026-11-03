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
  setAvailable: (available) => set({ available }),
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
  const { available, setStatus, setError, setProgress } = useUpdateStore.getState();
  if (!available) return;
  setError(null);
  setProgress(null);
  setStatus('downloading');
  try {
    await installUpdate(available.version);
    useUpdateStore.getState().setStatus('ready');
  } catch (e) {
    const s = useUpdateStore.getState();
    s.setError(messageOf(e));
    s.setStatus('error');
  }
}

// Remembers the skipped version and hides the notice.
export async function skipAvailableUpdate(): Promise<void> {
  const { available } = useUpdateStore.getState();
  if (!available) return;
  await skipUpdateVersion(available.version);
  useUpdateStore.getState().setAvailable(null);
}
