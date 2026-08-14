import {
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  getTelemetryFreshness,
  useStore,
  visibleLogicalState,
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateCSV, generateHTMLReport, downloadBlob, downloadFile } from "@/lib/exports";
import { getReleaseExportMetadata } from "@/lib/release";
import JSZip from "jszip";

export default function Logs() {
  const { transactions, tests, device, capabilities, connectionState, lastValidTelemetryAt } = useStore();

  const supportedTests = tests.filter(t => isTestSupported(t, capabilities));
  const supportedTransactions = transactions.filter(transaction => isTransactionSupported(transaction, capabilities));
  const enabledCapabilities = Object.fromEntries(
    Object.entries(capabilities).filter(([, enabled]) => enabled),
  );

  const exportJSON = () => {
    const log = {
      release: getReleaseExportMetadata(device.firmware),
      transactions: supportedTransactions,
    };
    downloadFile(JSON.stringify(log, null, 2), `lsn-tx-log-${Date.now()}.json`, 'application/json');
  };

  const exportCSV = () => {
    const release = getReleaseExportMetadata(device.firmware);
    const header = `# LSN Engineering Console ${release.consoleRelease} · Protocol ${release.protocolVersion} · Device Profile ${release.deviceProfileVersion} · Connected firmware ${release.connectedFirmwareVersion}`;
    const csv = generateCSV(supportedTransactions.map(t => ({
      sequence: t.sequence,
      timestamp: new Date(t.timestamp).toISOString(),
      direction: t.direction,
      command: t.command,
      mapping: t.mapping || 'NONE',
      hex: t.requestHex + ' -> ' + t.responseHex,
      status: t.status,
      latency: t.latency
    })));
    downloadFile(`${header}\n${csv}`, `lsn-tx-log-${Date.now()}.csv`, 'text/csv');
  };

  const exportTXT = () => {
    const release = getReleaseExportMetadata(device.firmware);
    const header = `# LSN Engineering Console ${release.consoleRelease} · Protocol ${release.protocolVersion} · Device Profile ${release.deviceProfileVersion} · Connected firmware ${release.connectedFirmwareVersion}`;
    const text = [header, ...supportedTransactions.map(t =>
      `${new Date(t.timestamp).toISOString()} #${t.sequence} ${t.direction.toUpperCase()} ${t.command} ${t.status.toUpperCase()} ${t.requestDecoded}`
    )].join('\n');
    downloadFile(text, `lsn-session-log-${Date.now()}.txt`, 'text/plain');
  };

  const exportValidationHTML = () => {
    const html = generateHTMLReport(supportedTests, device, Date.now());
    downloadFile(html, `lsn-validation-report-${Date.now()}.html`, 'text/html');
  };
  
  const exportValidationJSON = () => {
    const timestamp = Date.now();
    const report = {
      metadata: {
        release: getReleaseExportMetadata(device.firmware),
        device,
        enabledCapabilities,
        timestamp,
        validationScope: 'SIMULATION_TEST_HARNESS',
        firmwareImplementationInferred: false,
        telemetry: getTelemetryFreshness(connectionState, lastValidTelemetryAt, timestamp),
      },
      tests: supportedTests,
    };
    downloadFile(JSON.stringify(report, null, 2), `lsn-validation-report-${Date.now()}.json`, 'application/json');
  };

  const exportSupportBundle = async () => {
    const state = useStore.getState();
    const stateSupportedTests = state.tests.filter(t => isTestSupported(t, state.capabilities));
    const stateSupportedTransactions = state.transactions.filter(transaction => isTransactionSupported(transaction, state.capabilities));
    const stateEnabledCapabilities = Object.fromEntries(
      Object.entries(state.capabilities).filter(([, enabled]) => enabled),
    );
    const bundle = {
      timestamp: Date.now(),
      bundleFormatVersion: '0.1',
      release: getReleaseExportMetadata(state.device.firmware),
      device: state.device,
      mode: state.mode,
      telemetry: getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt),
      logicalStateSemantics: 'LAST_REPORTED_WHEN_TELEMETRY_IS_NOT_LIVE',
      validationScope: 'SIMULATION_TEST_HARNESS',
      firmwareImplementationInferred: false,
      enabledCapabilities: stateEnabledCapabilities,
      logicalState: visibleLogicalState(state.logicalState, state.capabilities),
      profile: state.profile.filter(item => isProfileItemSupported(item, state.capabilities)),
      settings: state.settings,
      transactions: stateSupportedTransactions,
      tests: stateSupportedTests
    };
    const zip = new JSZip();
    zip.file('support-bundle.json', JSON.stringify(bundle, null, 2));
    zip.file('transactions.csv', generateCSV(stateSupportedTransactions));
    zip.file('README.txt', 'LSN Engineering Console simulation support bundle. Simulation evidence is not firmware implementation, physical validation, or safety certification. Logical-state values are last reported whenever telemetry is not LIVE.');
    const blob = await zip.generateAsync({ type: 'blob' });
    // Route through the shared download helper so the packaged desktop
    // Console uses the native save dialog for support bundles too.
    downloadBlob(blob, `lsn-support-bundle-${Date.now()}.zip`);
  };

  return (
    <Card data-tour="logs-overview" className="max-w-4xl border-border bg-card/50 backdrop-blur h-full flex flex-col">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row justify-between items-center">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Session Logs & Exports
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 flex-1 flex flex-col gap-6">
        
        <div data-tour="logs-actions" className="grid grid-cols-3 gap-4">
          <div className="border border-border/50 bg-black/20 p-4 rounded-sm flex flex-col items-center justify-center gap-3 text-center">
            <div className="font-mono text-sm text-foreground">Transaction Log</div>
            <div className="font-mono text-[10px] text-muted-foreground">{transactions.length} Records</div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm" onClick={exportJSON} className="flex-1 font-mono text-[10px] h-7 border-primary text-primary hover:bg-primary/20">
                <Download className="w-3 h-3 mr-1" /> JSON
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV} className="flex-1 font-mono text-[10px] h-7 border-primary text-primary hover:bg-primary/20">
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportTXT} className="flex-1 font-mono text-[10px] h-7 border-primary text-primary hover:bg-primary/20">
                <Download className="w-3 h-3 mr-1" /> TXT
              </Button>
            </div>
          </div>
          <div className="border border-border/50 bg-black/20 p-4 rounded-sm flex flex-col items-center justify-center gap-3 text-center">
            <div className="font-mono text-sm text-foreground">Validation Report</div>
            <div className="font-mono text-[10px] text-muted-foreground">Test Execution Trace</div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm" onClick={exportValidationHTML} className="flex-1 font-mono text-[10px] h-7 border-border hover:bg-white/10">
                <Download className="w-3 h-3 mr-1" /> HTML
              </Button>
              <Button variant="outline" size="sm" onClick={exportValidationJSON} className="flex-1 font-mono text-[10px] h-7 border-border hover:bg-white/10">
                <Download className="w-3 h-3 mr-1" /> JSON
              </Button>
            </div>
          </div>
          <div className="border border-border/50 bg-black/20 p-4 rounded-sm flex flex-col items-center justify-center gap-3 text-center">
            <div className="font-mono text-sm text-foreground">Support Bundle</div>
            <div className="font-mono text-[10px] text-muted-foreground">State + logs + configuration (.zip)</div>
            <Button variant="outline" size="sm" onClick={exportSupportBundle} className="w-full font-mono text-[10px] h-7 border-border hover:bg-white/10">
              <Download className="w-3 h-3 mr-2" /> GENERATE BUNDLE
            </Button>
          </div>
        </div>

        <div data-tour="logs-table" className="flex-1 border border-border/50 bg-black/40 rounded-sm p-4 font-mono text-[10px] text-muted-foreground overflow-y-auto custom-scrollbar">
          <div className="text-primary mb-2">// RECENT LOG OUTPUT</div>
          {transactions.slice(0, 50).map(tx => (
            <div key={tx.id} className="mb-1 opacity-80 hover:opacity-100 hover:bg-white/5 px-1 py-0.5 rounded">
              <span className="text-foreground/50">[{new Date(tx.timestamp).toISOString()}]</span>{' '}
              <span className={tx.status === 'error' ? 'text-destructive' : 'text-success'}>[{tx.status.toUpperCase()}]</span>{' '}
              <span>{tx.requestDecoded} {tx.responseDecoded ? '-> ' + tx.responseDecoded : ''}</span>
            </div>
          ))}
          {transactions.length === 0 && (
            <div className="text-center py-8 opacity-50">NO LOGS AVAILABLE</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
