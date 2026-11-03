import { openUrl } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { restartApp, type UpdateInfo } from '@/lib/tauri-api';
import { installAvailableUpdate, skipAvailableUpdate, useUpdateStore } from '@/stores/update-store';

export const UPDATE_TOAST_ID = 'rocket-update';

const RELEASE_URL = 'https://github.com/Snehal1112/rocket/releases/tag/';

async function openRelease(version: string) {
  const url = `${RELEASE_URL}v${version.replace(/^v/, '')}`;
  try {
    await openUrl(url);
  } catch {
    // The URL is in the message so the user can copy it.
    toast.error(`Could not open the browser. Go to ${url}`);
  }
}

function isWindows(): boolean {
  try {
    return platform() === 'windows';
  } catch {
    return false;
  }
}

function percent(downloaded: number, total: number | null): number | null {
  if (!total) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

interface UpdateToastProps {
  info: UpdateInfo;
}

export function UpdateToast({ info }: UpdateToastProps) {
  const status = useUpdateStore((s) => s.status);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const installKind = useUpdateStore((s) => s.installKind);
  const openDialog = useUpdateStore((s) => s.openDialog);
  const manual = installKind === 'manual';
  const pct = progress ? percent(progress.downloaded, progress.total) : null;

  return (
    <div className='flex w-[356px] max-w-full flex-col gap-2 rounded-md border bg-popover p-4 text-popover-foreground shadow-lg'>
      <Button
        variant='link'
        className='h-auto justify-start p-0 text-left font-medium'
        onClick={openDialog}
      >
        Rocket {info.version} is available
      </Button>

      {status === 'downloading' && (
        <div className='flex flex-col gap-1'>
          <div
            role='progressbar'
            aria-label='Update download'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            className='h-2 w-full overflow-hidden rounded-full bg-muted'
          >
            <div className='h-full bg-primary transition-all' style={{ width: `${pct ?? 100}%` }} />
          </div>
          <span className='text-xs text-muted-foreground'>
            {pct === null ? 'Downloading...' : `Downloading ${pct}%`}
          </span>
        </div>
      )}

      {status === 'ready' && (
        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>The update is ready.</span>
          <Button size='sm' onClick={() => void restartApp()}>
            Restart
          </Button>
        </div>
      )}

      {status === 'error' && (
        <div className='flex flex-col gap-2'>
          <span className='text-sm text-destructive'>{error ?? 'The update failed.'}</span>
          <div className='flex flex-wrap items-center gap-2'>
            {!manual && (
              <Button size='sm' onClick={() => void installAvailableUpdate()}>
                Update
              </Button>
            )}
            <Button size='sm' variant='outline' onClick={() => void openRelease(info.version)}>
              View release
            </Button>
            <Button size='sm' variant='ghost' onClick={() => toast.dismiss(UPDATE_TOAST_ID)}>
              Later
            </Button>
          </div>
        </div>
      )}

      {status === 'idle' && (
        <>
          {!manual && isWindows() && (
            <span className='text-xs text-muted-foreground'>
              Rocket will close to finish the update.
            </span>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            {manual ? (
              <Button size='sm' onClick={() => void openRelease(info.version)}>
                View release
              </Button>
            ) : (
              <Button size='sm' onClick={() => void installAvailableUpdate()}>
                Update
              </Button>
            )}
            <Button size='sm' variant='outline' onClick={() => toast.dismiss(UPDATE_TOAST_ID)}>
              Later
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                void skipAvailableUpdate();
                toast.dismiss(UPDATE_TOAST_ID);
              }}
            >
              Skip this version
            </Button>
            <Button size='sm' variant='link' onClick={openDialog}>
              What's new
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
