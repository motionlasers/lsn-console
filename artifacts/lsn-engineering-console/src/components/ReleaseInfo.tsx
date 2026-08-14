import { type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CONSOLE_RELEASES,
  CURRENT_RELEASE,
  VERSION_TRACKS,
  getProtocolImpactSummary,
  type ConsoleRelease,
} from '@/lib/release';

/** Compact grid of the four independently versioned tracks. */
export function VersionTracks({ className = '' }: { className?: string }) {
  const tracks = [
    VERSION_TRACKS.console,
    VERSION_TRACKS.protocol,
    VERSION_TRACKS.deviceProfile,
    VERSION_TRACKS.firmwareInterface,
  ];
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs ${className}`} data-testid="version-tracks">
      {tracks.map(track => (
        <div key={track.name} className="border border-border bg-card/50 p-3 rounded-sm">
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest">{track.name}</div>
          <div className="mt-1 text-foreground font-bold break-all">{track.label}</div>
        </div>
      ))}
    </div>
  );
}

function ReleaseSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">{title}</div>
      <ul className="list-disc pl-4 space-y-1 marker:text-primary/50">
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export function ProtocolImpactBanner({ release }: { release: ConsoleRelease }) {
  const summary = getProtocolImpactSummary(release);
  const toneClass =
    summary.tone === 'critical'
      ? 'border-destructive/50 bg-destructive/10 text-destructive'
      : summary.tone === 'warning'
        ? 'border-warning/50 bg-warning/10 text-warning'
        : 'border-border/50 bg-black/20 text-muted-foreground';
  return (
    <div className={`border p-3 rounded-sm text-[11px] font-mono ${toneClass}`} data-testid={`protocol-impact-${summary.tone}`}>
      <strong className="tracking-wide block mb-1">{summary.headline}</strong>
      <span className="opacity-90 leading-relaxed">{summary.statement}</span>
    </div>
  );
}

export function ReleaseEntry({ release }: { release: ConsoleRelease }) {
  return (
    <div className="space-y-4 text-[11px] font-mono text-muted-foreground leading-relaxed">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2">
        <div className="text-sm font-bold text-foreground">{release.label}</div>
        <div className="text-[10px] uppercase tracking-widest">{release.date}</div>
      </div>
      <ProtocolImpactBanner release={release} />
      <div className="text-[10px] text-muted-foreground/90">{release.deviceProfileImpactStatement}</div>
      <ReleaseSection title="Added" items={release.added} />
      <ReleaseSection title="Changed" items={release.changed} />
      <ReleaseSection title="Fixed" items={release.fixed} />
      <ReleaseSection title="Known limitations" items={release.knownLimitations} />
    </div>
  );
}

/** Full changelog dialog rendered from the shared release history. */
export function ChangelogDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl" data-testid="dialog-changelog">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-widest uppercase">
            Console Release History
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            Current: {CURRENT_RELEASE.label}. LSN Protocol, Device Profile, and the
            Firmware Interface package are versioned independently and remain at v0.1.
          </DialogDescription>
        </DialogHeader>
        <VersionTracks />
        <ScrollArea className="max-h-[50vh] pr-4">
          <div className="space-y-8">
            {CONSOLE_RELEASES.map(release => (
              <ReleaseEntry key={release.version} release={release} />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
