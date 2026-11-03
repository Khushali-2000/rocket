import { toast } from 'sonner';
import { MarkdownRenderer } from '@/components/collections/MarkdownRenderer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openRelease, UPDATE_TOAST_ID } from '@/components/updates/UpdateToast';
import { restartApp } from '@/lib/tauri-api';
import { installAvailableUpdate, skipAvailableUpdate, useUpdateStore } from '@/stores/update-store';

// Shows the release notes of the available update. Mount once.
export function UpdateDialog() {
  const open = useUpdateStore((s) => s.dialogOpen);
  const available = useUpdateStore((s) => s.available);
  const status = useUpdateStore((s) => s.status);
  const error = useUpdateStore((s) => s.error);
  const installKind = useUpdateStore((s) => s.installKind);
  const closeDialog = useUpdateStore((s) => s.closeDialog);
  const manual = installKind === 'manual';

  if (!available) return null;

  const onSkip = () => {
    void skipAvailableUpdate();
    toast.dismiss(UPDATE_TOAST_ID);
    closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Rocket {available.version}</DialogTitle>
          <DialogDescription>{available.date ?? 'A new version is available.'}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {available.notes?.trim() ? (
            <MarkdownRenderer restricted>{available.notes}</MarkdownRenderer>
          ) : (
            <p className='text-sm text-muted-foreground'>No release notes.</p>
          )}
          {status === 'downloading' && (
            <p className='mt-3 text-sm text-muted-foreground'>Downloading...</p>
          )}
          {status === 'error' && (
            <p className='mt-3 text-sm text-destructive'>{error ?? 'The update failed.'}</p>
          )}
        </DialogBody>
        <DialogFooter>
          {status === 'ready' ? (
            <Button onClick={() => void restartApp()}>Restart</Button>
          ) : manual ? (
            <Button onClick={() => void openRelease(available.version)}>View release</Button>
          ) : (
            <>
              <Button
                disabled={status === 'downloading'}
                onClick={() => void installAvailableUpdate()}
              >
                Update
              </Button>
              {status === 'error' && (
                <Button variant='outline' onClick={() => void openRelease(available.version)}>
                  View release
                </Button>
              )}
            </>
          )}
          {status !== 'ready' && (
            <Button variant='ghost' disabled={status === 'downloading'} onClick={onSkip}>
              Skip this version
            </Button>
          )}
          <Button variant='outline' onClick={closeDialog}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
