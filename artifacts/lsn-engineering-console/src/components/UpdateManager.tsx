import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  type DesktopUpdateState,
  getDesktopBridge,
} from '@/lib/desktop';

interface UpdateContextValue {
  state: DesktopUpdateState | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  defer: () => Promise<void>;
  review: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [errorHidden, setErrorHidden] = useState(false);
  const [reviewingDeferred, setReviewingDeferred] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    let cancelled = false;
    const unsubscribe = bridge.onUpdateState((next) => {
      if (!cancelled) setState(next);
    });
    void bridge.getUpdateState().then((next) => {
      if (!cancelled) setState(next);
    }).catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          currentVersion: 'unknown',
          message:
            'Update status is unavailable. The installed version is unaffected.',
          errorCode: 'UPDATE_BRIDGE_FAILED',
          canRetry: true,
        });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state?.status !== 'error') setErrorHidden(false);
    if (state?.status !== 'deferred') setReviewingDeferred(false);
  }, [state?.status]);

  const check = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setErrorHidden(false);
    setState(await bridge.checkForUpdates());
  }, []);

  const install = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setReviewingDeferred(false);
    setState(await bridge.installUpdate());
  }, []);

  const defer = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setReviewingDeferred(false);
    setState(await bridge.deferUpdate());
  }, []);

  const value = useMemo<UpdateContextValue>(
    () => ({
      state,
      check,
      install,
      defer,
      review: () => setReviewingDeferred(true),
    }),
    [check, defer, install, state],
  );

  const showReadyDialog =
    state?.status === 'ready' ||
    (state?.status === 'deferred' && reviewingDeferred);

  return (
    <UpdateContext.Provider value={value}>
      {children}

      {state?.status === 'downloading' && (
        <div
          className="fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] border border-primary/40 bg-card shadow-2xl"
          role="status"
          aria-live="polite"
          data-testid="desktop-update-progress"
        >
          <div className="flex items-start gap-3 p-4">
            <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-3 font-mono text-xs">
                <span className="font-bold tracking-wider text-foreground">
                  DOWNLOADING v{state.latestVersion}
                </span>
                <span className="text-primary">
                  {state.percent === undefined ? 'IN PROGRESS' : `${state.percent}%`}
                </span>
              </div>
              <Progress value={state.percent ?? 0} className="h-1.5" />
              <p className="font-mono text-[10px] text-muted-foreground">
                {formatBytes(state.receivedBytes)}
                {state.totalBytes
                  ? ` of ${formatBytes(state.totalBytes)}`
                  : ' downloaded'}
                . You can continue working while the update downloads.
              </p>
            </div>
          </div>
        </div>
      )}

      {state?.status === 'error' && !errorHidden && (
        <div
          className="fixed bottom-5 right-5 z-50 w-[min(26rem,calc(100vw-2.5rem))] border border-warning/50 bg-card shadow-2xl"
          role="alert"
          data-testid="desktop-update-error"
        >
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="font-mono text-xs font-bold tracking-wider text-warning">
                  UPDATE NOT INSTALLED
                </p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {state.message}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 font-mono text-[10px]"
                onClick={() => void check()}
                disabled={!state.canRetry}
                data-testid="button-update-retry"
              >
                <RefreshCw className="mr-2 h-3 w-3" />
                RETRY
              </Button>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label="Dismiss update message"
              onClick={() => setErrorHidden(true)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={showReadyDialog}
        onOpenChange={(open) => {
          if (!open) void defer();
        }}
      >
        <DialogContent
          className="max-w-md border-primary/40"
          data-testid="dialog-desktop-update-ready"
        >
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center border border-primary/40 bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">
              Verified update ready
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px] leading-relaxed">
              LSN Engineering Console v{state?.latestVersion} has been downloaded.
              Its checksum and Saber Windows signature were verified. Install now,
              or keep using v{state?.currentVersion} and install later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => void defer()}
              data-testid="button-update-later"
            >
              LATER
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => void install()}
              data-testid="button-update-install"
            >
              INSTALL NOW
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {state?.status === 'installing' && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="assertive"
          data-testid="desktop-update-installing"
        >
          <div className="flex items-center gap-3 border border-primary/40 bg-card px-5 py-4 font-mono text-xs">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            STARTING VERIFIED INSTALLER…
          </div>
        </div>
      )}
    </UpdateContext.Provider>
  );
}

export function UpdateCheckButton() {
  const context = useContext(UpdateContext);
  const state = context?.state;
  if (!context || !state || state.status === 'unsupported') return null;

  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  const prepared = ['ready', 'deferred'].includes(state.status);
  const label = prepared
    ? `REVIEW UPDATE v${state.latestVersion}`
    : state.status === 'checking'
      ? 'CHECKING…'
      : state.status === 'downloading'
        ? `DOWNLOADING ${state.percent ?? ''}${state.percent === undefined ? '' : '%'}`
        : 'CHECK FOR UPDATES';

  return (
    <Button
      data-testid="button-check-for-updates"
      variant="outline"
      className="font-mono text-xs border-border text-muted-foreground hover:text-foreground"
      disabled={busy}
      onClick={() => {
        if (prepared) context.review();
        else void context.check();
      }}
    >
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}