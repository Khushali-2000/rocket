import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { openRelease } from '@/components/updates/UpdateToast';
import { checkForUpdate, getUpdateSettings, restartApp, setUpdateAutoCheck } from '@/lib/tauri-api';
import { installAvailableUpdate, useUpdateStore } from '@/stores/update-store';

type CheckState = 'idle' | 'checking' | 'latest' | 'failed';

export function UpdatesBlock() {
  const available = useUpdateStore((s) => s.available);
  const status = useUpdateStore((s) => s.status);
  const error = useUpdateStore((s) => s.error);
  const installKind = useUpdateStore((s) => s.installKind);
  const [current, setCurrent] = useState<string | null>(null);
  const [autoCheck, setAutoCheck] = useState<boolean | null>(null);
  const [check, setCheck] = useState<CheckState>('idle');
  const manual = installKind === 'manual';

  useEffect(() => {
    let disposed = false;
    getVersion().then(
      (v) => !disposed && setCurrent(v),
      () => !disposed && setCurrent(null),
    );
    getUpdateSettings().then(
      (s) => !disposed && setAutoCheck(s.autoCheck),
      () => !disposed && setAutoCheck(null),
    );
    return () => {
      disposed = true;
    };
  }, []);

  const onToggle = (next: boolean) => {
    const previous = autoCheck;
    setAutoCheck(next);
    setUpdateAutoCheck(next).catch(() => setAutoCheck(previous));
  };

  const onCheck = async () => {
    setCheck('checking');
    try {
      // A manual check ignores the skipped version.
      const info = await checkForUpdate();
      if (info) {
        useUpdateStore.getState().setAvailable(info);
        setCheck('idle');
      } else {
        setCheck('latest');
      }
    } catch {
      setCheck('failed');
    }
  };

  return (
    <div className='mt-6 flex flex-col gap-3 border-t pt-4 text-sm'>
      <h3 className='font-medium'>Updates</h3>
      <div className='flex items-center justify-between'>
        <Label htmlFor='update-auto-check' className='text-sm'>
          Check for updates automatically
        </Label>
        <Switch
          id='update-auto-check'
          checked={autoCheck ?? false}
          disabled={autoCheck === null}
          onCheckedChange={onToggle}
        />
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground'>
          {available ? `Rocket ${available.version} is available` : 'Up to date'}
          {current ? ` (current ${current})` : ''}
        </span>
        <Button
          size='sm'
          variant='outline'
          disabled={check === 'checking'}
          onClick={() => void onCheck()}
        >
          {check === 'checking' ? 'Checking...' : 'Check now'}
        </Button>
      </div>
      {check === 'latest' && !available && (
        <span className='text-muted-foreground'>You are on the latest version</span>
      )}
      {check === 'failed' && <span className='text-destructive'>Could not check for updates.</span>}
      {available && (
        <div className='flex flex-wrap items-center gap-2'>
          {status === 'ready' ? (
            <Button size='sm' onClick={() => void restartApp()}>
              Restart
            </Button>
          ) : (
            <>
              {!manual && (
                <Button
                  size='sm'
                  disabled={status === 'downloading'}
                  onClick={() => void installAvailableUpdate()}
                >
                  {status === 'downloading' ? 'Downloading...' : 'Update'}
                </Button>
              )}
              <Button
                size='sm'
                variant='outline'
                onClick={() => void openRelease(available.version)}
              >
                View release
              </Button>
            </>
          )}
          {status === 'error' && (
            <span className='text-destructive'>{error ?? 'The update failed.'}</span>
          )}
        </div>
      )}
    </div>
  );
}
