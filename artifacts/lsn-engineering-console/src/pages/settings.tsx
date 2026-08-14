import {
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  getTelemetryFreshness,
  useStore,
  visibleLogicalState,
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, RefreshCw, Download, Upload, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/exports";
import { useRef } from "react";
import { useTourStore } from "@/hooks/use-tour";

export default function SettingsPage() {
  const { settings, logicalState, updateSettings, updateLogicalState, resetSettings, importState } = useStore();
  const { startTour } = useTourStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedBrandLogo = settings.brandLogo ?? 'sia';

  const handleExportState = () => {
    const state = useStore.getState();
    const snapshot = {
      version: '0.1',
      timestamp: Date.now(),
      device: state.device,
      telemetry: getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt),
      logicalStateSemantics: 'LAST_REPORTED_WHEN_TELEMETRY_IS_NOT_LIVE',
      validationScope: 'SIMULATION_TEST_HARNESS',
      firmwareImplementationInferred: false,
      logicalState: visibleLogicalState(state.logicalState, state.capabilities),
      profile: state.profile.filter(item => isProfileItemSupported(item, state.capabilities)),
      transactions: state.transactions.filter(transaction => isTransactionSupported(transaction, state.capabilities)),
      tests: state.tests.filter(test => isTestSupported(test, state.capabilities)),
      settings: state.settings,
      enabledCapabilities: Object.fromEntries(
        Object.entries(state.capabilities).filter(([, enabled]) => enabled),
      ),
    };
    downloadFile(JSON.stringify(snapshot, null, 2), `lsn-state-export.json`, 'application/json');
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        importState(e.target.result as string);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Card className="max-w-2xl border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Console Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-mono text-foreground">Navigation Brand</div>
              <div className="text-xs font-mono text-muted-foreground">Choose the logo shown at the top of the navigation bar</div>
            </div>
            <div className="flex rounded-sm border border-border p-1" role="group" aria-label="Navigation brand">
              {([
                ['sia', 'SIA'],
                ['bls', 'BLS'],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="sm"
                  className={`h-7 px-3 font-mono text-xs ${
                    selectedBrandLogo === value
                      ? 'bg-primary/20 text-primary hover:bg-primary/20 hover:text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => updateSettings({ brandLogo: value })}
                  aria-pressed={selectedBrandLogo === value}
                  data-testid={`button-brand-${value}`}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div>
              <div className="text-sm font-mono text-foreground">Developer Mode</div>
              <div className="text-xs font-mono text-muted-foreground">Expose raw diagnostic tools and edit profile spec</div>
            </div>
            <Button 
              variant="outline" 
              className={`font-mono text-xs border ${settings.devMode ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
              onClick={() => updateSettings({ devMode: !settings.devMode })}
            >
              {settings.devMode ? 'ENABLED' : 'DISABLED'}
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div>
              <div className="text-sm font-mono text-foreground">Local Persistence</div>
              <div className="text-xs font-mono text-muted-foreground">Save console state and logs to browser storage</div>
            </div>
            <Button 
              variant="outline" 
              className={`font-mono text-xs border ${settings.localPersistence ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
              onClick={() => updateSettings({ localPersistence: !settings.localPersistence })}
            >
              {settings.localPersistence ? 'ENABLED' : 'DISABLED'}
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-4">
            <div>
              <div className="text-sm font-mono text-foreground">First-Launch Tour</div>
              <div className="text-xs font-mono text-muted-foreground">Replay the guided console overview</div>
            </div>
            <Button 
              variant="outline" 
              className="font-mono text-xs border-border text-foreground hover:text-primary hover:border-primary/50"
              onClick={() => startTour()}
              data-testid="button-settings-replay-tour"
            >
              <Play className="w-3 h-3 mr-2" /> REPLAY TOUR
            </Button>
          </div>
          
          <div className="flex flex-col gap-2 border-t border-border/50 pt-4">
            <div className="text-sm font-mono text-foreground">Simulation Timing Profile</div>
            <div className="text-xs font-mono text-muted-foreground mb-2">Adjust artificial latency for simulation responses</div>
            <div className="flex gap-2">
              {[10, 50, 100, 500].map(val => (
                 <Button 
                   key={val}
                   variant="outline"
                   className={`flex-1 font-mono text-xs ${settings.simulatorTiming === val ? 'bg-primary/20 border-primary text-primary' : 'border-border text-muted-foreground'}`}
                   onClick={() => updateSettings({ simulatorTiming: val })}
                 >
                   {val}ms
                 </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
            <div className="text-sm font-mono text-foreground">Simulation Fault Controls</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className={`font-mono text-xs ${logicalState.commsLoss ? 'border-destructive text-destructive' : 'border-border'}`} onClick={() => updateLogicalState({ commsLoss: !logicalState.commsLoss })}>
                COMMUNICATION {logicalState.commsLoss ? 'LOST' : 'NORMAL'}
              </Button>
              <Button variant="outline" className={`font-mono text-xs ${logicalState.storageFailure ? 'border-destructive text-destructive' : 'border-border'}`} onClick={() => updateLogicalState({ storageFailure: !logicalState.storageFailure })}>
                STORAGE {logicalState.storageFailure ? 'FAILED' : 'NORMAL'}
              </Button>
            </div>
            <div className="text-xs font-mono text-muted-foreground">Dropped response simulation</div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 25, 100].map(rate => (
                <Button key={rate} variant="outline" className={`font-mono text-xs ${settings.droppedResponseRate === rate ? 'border-primary text-primary' : 'border-border'}`} onClick={() => updateSettings({ droppedResponseRate: rate })}>
                  {rate}%
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-border/50 flex justify-between">
          <div className="flex gap-2">
             <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
             <Button variant="outline" className="font-mono text-xs text-muted-foreground border-border hover:bg-white/10" onClick={handleImportClick}>
               <Upload className="w-3 h-3 mr-2" /> IMPORT STATE
             </Button>
             <Button variant="outline" className="font-mono text-xs text-muted-foreground border-border hover:bg-white/10" onClick={handleExportState}>
               <Download className="w-3 h-3 mr-2" /> EXPORT STATE
             </Button>
          </div>
          <Button variant="outline" className="font-mono text-xs text-destructive border-destructive/50 hover:bg-destructive hover:text-white" onClick={resetSettings}>
            <RefreshCw className="w-3 h-3 mr-2" /> RESET DEFAULTS
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
