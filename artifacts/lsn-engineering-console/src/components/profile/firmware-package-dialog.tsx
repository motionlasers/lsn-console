import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PackageOpen, Download, Loader2, AlertTriangle } from "lucide-react";
import {
  createFirmwareIntegrationPackage,
  summarizeFirmwarePackage,
} from "@/lib/firmware-package";
import {
  type ImmutableProfileVersion,
} from "@/lib/profile-governance-api";
import { downloadBlob } from "@/lib/exports";

interface FirmwarePackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: ImmutableProfileVersion[];
  developmentPublishedVersionIds: number[];
}

/**
 * Firmware Integration Package export dialog.
 *
 * A package may only be generated from an immutable version that has been
 * published to the DEVELOPMENT channel. The package is generated from that
 * version's frozen `document` snapshot — never from the mutable working
 * activeProfileDocument. The dialog visibly identifies the governed version
 * number and full digest, and passes both into the package so the README,
 * manifest, and filename all carry the same identity.
 */
export function FirmwarePackageDialog({
  open,
  onOpenChange,
  versions,
  developmentPublishedVersionIds,
}: FirmwarePackageDialogProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishedVersions = useMemo(
    () => {
      const publishedIds = new Set(developmentPublishedVersionIds);
      return versions.filter(version => publishedIds.has(version.id));
    },
    [developmentPublishedVersionIds, versions],
  );

  const selected = useMemo(
    () => publishedVersions.find(v => v.id === selectedId) ?? null,
    [publishedVersions, selectedId],
  );

  const capabilities = useMemo(() => {
    if (!selected) return {};
    return Object.fromEntries(
      Object.entries(selected.document.capabilities).map(([key, cap]) => [key, cap.enabled]),
    );
  }, [selected]);

  const summary = useMemo(
    () => (selected ? summarizeFirmwarePackage(selected.document, capabilities) : null),
    [selected, capabilities],
  );

  const handleExport = async () => {
    if (!selected) return;
    setIsExporting(true);
    setError(null);
    try {
      const result = await createFirmwareIntegrationPackage(selected.document, capabilities, {
        governedSource: { versionNumber: selected.versionNumber, digest: selected.digest },
      });
      downloadBlob(result.blob, result.filename);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Package generation failed.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base tracking-wider text-primary">
            <PackageOpen className="h-5 w-5" />
            Firmware Integration Package
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Select an immutable version published to DEVELOPMENT. The package is generated from that governed
            version's frozen document only — never the mutable working editor.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 font-mono text-xs">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Governed Source Version</span>
          <select
            className="h-9 rounded-sm border border-border/60 bg-black/40 px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            value={selectedId ?? ""}
            onChange={e => setSelectedId(e.target.value === "" ? null : Number(e.target.value))}
            data-testid="select-firmware-package-version"
          >
            <option value="" className="bg-background">Select a published-to-DEVELOPMENT version…</option>
            {publishedVersions.map(v => (
              <option key={v.id} value={v.id} className="bg-background">
                Version {v.versionNumber} — {v.state}
              </option>
            ))}
          </select>
        </label>

        {publishedVersions.length === 0 && (
          <div
            className="border border-warning/40 bg-warning/10 p-3 font-mono text-xs text-warning"
            data-testid="firmware-package-no-published"
          >
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            No version has been published to DEVELOPMENT yet. Publish a version before exporting a package.
          </div>
        )}

        {selected && summary && (
          <div className="flex flex-col gap-3">
            <div className="border border-primary/40 bg-primary/5 p-3 font-mono text-xs" data-testid="firmware-package-governed-identity">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Governed Version</div>
                  <div className="text-foreground" data-testid="text-governed-version">Version {selected.versionNumber}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">State</div>
                  <div className="text-foreground">{selected.state}</div>
                </div>
              </div>
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Full Digest</div>
                <div className="break-all text-primary" data-testid="text-governed-digest">{selected.digest}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono text-xs" data-testid="firmware-package-summary">
              <div className="border border-border bg-card/50 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Profile / Protocol</div>
                <div className="mt-1 text-foreground">{summary.profileVersion} / {summary.protocolVersion}</div>
              </div>
              <div className="border border-border bg-card/50 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Interface</div>
                <div className="mt-1 text-foreground">{summary.activeFieldCount} FIELDS</div>
              </div>
              <div className="border border-border bg-card/50 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Resolved Mappings</div>
                <div className="mt-1 text-success">{summary.mappedFieldCount} MAPPED</div>
              </div>
              <div className="border border-border bg-card/50 p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">TBD Mappings</div>
                <div className={`mt-1 ${summary.tbdFieldCount > 0 ? "text-warning" : "text-muted-foreground"}`}>{summary.tbdFieldCount} TBD</div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive" data-testid="firmware-package-error">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting} className="font-mono text-xs">
            CANCEL
          </Button>
          <Button
            onClick={handleExport}
            disabled={!selected || isExporting}
            className="font-mono text-xs"
            data-testid="button-confirm-firmware-package"
          >
            {isExporting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> GENERATING ZIP</>
            ) : (
              <><Download className="mr-2 h-4 w-4" /> GENERATE & DOWNLOAD ZIP</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
