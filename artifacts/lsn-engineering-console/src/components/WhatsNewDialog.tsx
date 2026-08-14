import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProtocolImpactBanner, ReleaseEntry, ChangelogDialog } from '@/components/ReleaseInfo';
import { CURRENT_RELEASE, CONSOLE_VERSION, releaseRequiresFirmwareAction } from '@/lib/release';
import { isPackagedDesktopRuntime } from '@/lib/desktop';
import {
  acknowledgeWhatsNew,
  getAcknowledgedWhatsNewVersion,
  shouldShowWhatsNew,
} from '@/lib/whats-new';

/**
 * Shown once per newly installed Console version in the packaged desktop
 * runtime. Acknowledgment is stored independently of optional engineering
 * state persistence and never reopens on subsequent launches.
 */
export function WhatsNewDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const packaged = await isPackagedDesktopRuntime();
      if (cancelled) return;
      if (shouldShowWhatsNew(getAcknowledgedWhatsNewVersion(), CONSOLE_VERSION, packaged)) {
        setOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    acknowledgeWhatsNew(CONSOLE_VERSION);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-whats-new">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-widest uppercase">
            What&apos;s New — {CURRENT_RELEASE.label}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            This summary is shown once for each newly installed Console version.
          </DialogDescription>
        </DialogHeader>
        {releaseRequiresFirmwareAction(CURRENT_RELEASE) && (
          <ProtocolImpactBanner release={CURRENT_RELEASE} />
        )}
        <ScrollArea className="max-h-[45vh] pr-4">
          <ReleaseEntry release={CURRENT_RELEASE} />
        </ScrollArea>
        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          <ChangelogDialog
            trigger={
              <Button variant="outline" size="sm" className="font-mono text-xs" data-testid="button-whats-new-changelog">
                FULL CHANGELOG
              </Button>
            }
          />
          <Button size="sm" className="font-mono text-xs" onClick={dismiss} data-testid="button-whats-new-dismiss">
            GOT IT
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
