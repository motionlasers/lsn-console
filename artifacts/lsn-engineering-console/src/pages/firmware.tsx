import { useStore, type FirmwarePackageMetadata } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListTree, DownloadCloud, AlertTriangle, RefreshCw, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";

const BUILT_IN_PACKAGES: FirmwarePackageMetadata[] = [
  { id: 'happy_path', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'happy_path' },
  { id: 'interrupted_network', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'interrupted_network' },
  { id: 'incomplete_transfer', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'incomplete_transfer' },
  { id: 'image_corruption', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:corrupt...sim', signature: 'VALID', scenario: 'image_corruption' },
  { id: 'checksum_failure', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:mismatch...sim', signature: 'VALID', scenario: 'checksum_failure' },
  { id: 'signature_failure', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'INVALID', scenario: 'signature_failure' },
  { id: 'incompatible_firmware', version: '1.0.0-sim', target: 'ESP32-S3', protocol: 'LSN v0.2', size: 2100000, checksum: 'sha256:999fff...sim', signature: 'VALID', scenario: 'incompatible_firmware' },
  { id: 'reboot_failure', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1246000, checksum: 'sha256:555eee...sim', signature: 'VALID', scenario: 'reboot_failure' },
  { id: 'post_boot_fail', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1246000, checksum: 'sha256:555eee...sim', signature: 'VALID', scenario: 'post_boot_fail' },
  { id: 'power_loss_before_activation', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'power_loss_before_activation' },
  { id: 'power_loss_after_activation', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'power_loss_after_activation' },
  { id: 'known_good_recovery', version: '0.2.0-sim', target: 'WT32-ETH01', protocol: 'LSN v0.1', size: 1245000, checksum: 'sha256:32b9d5e7...sim', signature: 'VALID', scenario: 'known_good_recovery' },
];

export default function Firmware() {
  const { device, mode, firmwareState, startFirmwareUpdate, resetFirmwareState } = useStore();
  const [packages, setPackages] = useState(BUILT_IN_PACKAGES);
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [manifestError, setManifestError] = useState('');
  const manifestInput = useRef<HTMLInputElement>(null);

  const activePkg = packages.find(p => p.id === selectedPkg);

  const importManifest = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as Partial<FirmwarePackageMetadata>;
        if (!value.version || !value.target || !value.protocol || !value.checksum || !value.scenario || !Number.isFinite(value.size)) {
          throw new Error('Manifest requires version, target, protocol, checksum, scenario, and numeric size.');
        }
        if (!['VALID', 'INVALID', 'UNSIGNED'].includes(String(value.signature))) {
          throw new Error('Signature must be VALID, INVALID, or UNSIGNED.');
        }
        const imported: FirmwarePackageMetadata = {
          id: value.id || `imported-${Date.now()}`,
          version: value.version,
          target: value.target,
          protocol: value.protocol,
          size: Number(value.size),
          checksum: value.checksum,
          signature: value.signature as FirmwarePackageMetadata['signature'],
          scenario: value.scenario,
        };
        setPackages(current => [imported, ...current.filter(item => item.id !== imported.id)]);
        setSelectedPkg(imported.id);
        setManifestError('');
      } catch (error) {
        setManifestError(error instanceof Error ? error.message : 'Manifest parsing failed.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <Card className="max-w-4xl border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <ListTree className="w-4 h-4" />
          Firmware Management Simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        
        <div className="grid grid-cols-2 gap-4 bg-black/20 p-4 border border-border/50 rounded-sm">
          <div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Current Version</div>
            <div className="text-lg font-mono text-primary">{device.firmware}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Status</div>
            <div className="text-sm font-mono text-success">{firmwareState.deviceState.toUpperCase()}</div>
          </div>
        </div>

        {firmwareState.isActive || firmwareState.stage === 'failed' || firmwareState.stage === 'completed' ? (
          <div className="border border-border/50 rounded-sm p-6 bg-black/30 flex flex-col gap-4">
            <h3 className="font-mono text-sm text-foreground mb-2">Update Progress</h3>
            
            <div className="w-full bg-black border border-border/50 h-4 rounded-sm overflow-hidden relative">
              <div 
                className={`h-full transition-all duration-300 ${firmwareState.stage === 'failed' ? 'bg-destructive' : 'bg-primary'}`} 
                style={{ width: `${firmwareState.progress}%` }} 
              />
            </div>
            
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-muted-foreground uppercase">Stage: <span className="text-foreground">{firmwareState.stage}</span></span>
              <span className="text-muted-foreground">{Math.round(firmwareState.progress)}%</span>
            </div>

            {(firmwareState.stage === 'failed' || firmwareState.stage === 'completed') && (
              <div className={`mt-4 p-4 border rounded-sm text-xs font-mono ${firmwareState.stage === 'failed' ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'bg-success/10 border-success/30 text-success'}`}>
                <div className="font-bold mb-2 uppercase">{firmwareState.stage === 'failed' ? 'UPDATE FAILED' : 'UPDATE SUCCESSFUL'}</div>
                {firmwareState.stage === 'failed' ? (
                  <ul className="space-y-1 opacity-90">
                    <li>Reason: {firmwareState.failureReason}</li>
                    <li>Failed at stage: {firmwareState.failureStage}</li>
                    <li>Resulting Version: {firmwareState.resultingVersion}</li>
                    <li>Rollback Occurred: {firmwareState.rollbackOccurred ? 'YES' : 'NO'}</li>
                    <li>Known-Good Available: {firmwareState.knownGoodAvailable ? 'YES' : 'NO'}</li>
                    <li>Running Firmware Affected: {firmwareState.runningFirmwareAffected ? 'YES' : 'NO'}</li>
                    <li className="mt-2 text-foreground">Recommended: {firmwareState.recommendedNextStep}</li>
                  </ul>
                ) : (
                  <ul className="space-y-1 opacity-90">
                    <li>Resulting Version: {firmwareState.resultingVersion}</li>
                    <li>Validation: Basic Validation Auto-Run Executed</li>
                    <li>Basic Validation Result: {firmwareState.basicValidationStatus.toUpperCase()}</li>
                    <li className="mt-2 text-foreground">Recommended: {firmwareState.recommendedNextStep}</li>
                  </ul>
                )}
                
                <Button variant="outline" size="sm" onClick={resetFirmwareState} className="mt-4 border-border text-foreground hover:bg-white/10">
                  <RefreshCw className="w-3 h-3 mr-2" /> ACKNOWLEDGE & RESET
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <div className="border border-border/50 rounded-sm p-4 h-[300px] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-mono text-sm text-foreground">Package Selection</h3>
                <span className="text-[10px] font-mono text-muted-foreground bg-black/30 px-2 py-1 rounded">SIMULATION TARGETS</span>
              </div>
              
              <div className="flex flex-col gap-2">
                <input ref={manifestInput} type="file" accept=".json,application/json" className="hidden" onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) importManifest(file);
                  event.target.value = '';
                }} />
                <Button variant="outline" size="sm" className="mb-2 font-mono text-[10px]" onClick={() => manifestInput.current?.click()}>
                  <FileJson className="w-3 h-3 mr-2" /> IMPORT PACKAGE MANIFEST
                </Button>
                {manifestError && <div className="mb-2 text-[10px] font-mono text-destructive">{manifestError}</div>}
                {packages.map(pkg => (
                  <div 
                    key={pkg.id} 
                    className={`border p-3 flex flex-col gap-1 cursor-pointer transition-colors ${selectedPkg === pkg.id ? 'border-primary bg-primary/10' : 'border-border/30 bg-black/10 hover:border-primary/50'}`}
                    onClick={() => setSelectedPkg(pkg.id)}
                  >
                    <div className="font-mono text-sm font-bold text-foreground">{pkg.version}</div>
                    <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                      <FileJson className="w-3 h-3" /> Scenario: {pkg.scenario}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-border/50 rounded-sm p-4 flex flex-col">
              <h3 className="font-mono text-sm text-foreground mb-4">Package Metadata</h3>
              {activePkg ? (
                <div className="space-y-3 text-xs font-mono flex-1">
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Version</span>
                    <span>{activePkg.version}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Hardware Target</span>
                    <span className={activePkg.target !== device.platform ? 'text-destructive font-bold' : ''}>{activePkg.target}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Protocol</span>
                    <span>{activePkg.protocol}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Size</span>
                    <span>{(activePkg.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Checksum</span>
                    <span className="truncate max-w-[150px]" title={activePkg.checksum}>{activePkg.checksum}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/30 pb-1">
                    <span className="text-muted-foreground">Signature</span>
                    <span className={activePkg.signature === 'INVALID' ? 'text-destructive font-bold' : 'text-success'}>{activePkg.signature}</span>
                  </div>

                  <Button 
                    className="w-full mt-4 font-mono text-xs border-primary text-primary hover:bg-primary/20" 
                    variant="outline"
                    disabled={mode === 'hardware'}
                    onClick={() => startFirmwareUpdate(activePkg.scenario, activePkg)}
                  >
                    <DownloadCloud className="w-4 h-4 mr-2" /> EXECUTE UPDATE
                  </Button>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs font-mono border border-dashed border-border/30 rounded-sm p-4 text-center">
                  SELECT A PACKAGE TO VIEW METADATA
                </div>
              )}
            </div>
          </div>
        )}

        {mode === 'hardware' && (
          <div className="mt-8 p-4 border border-warning/30 bg-warning/10 text-warning text-sm font-mono flex items-start gap-3 rounded-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <strong>OTA UPDATES DISABLED IN HARDWARE MODE</strong>
              <p className="text-xs opacity-80 mt-1">
                Firmware flashing is physically disabled in Hardware Mode until the validation suite passes Phase 2.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
