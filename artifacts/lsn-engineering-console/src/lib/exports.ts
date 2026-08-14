import { effectiveFirmwareStatus } from './store';

export function downloadFile(content: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function generateCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(header => {
      const val = row[header];
      return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function generateMarkdownProfile(profile: any[]): string {
  let md = `# LSN Interface Specification (v0.1)\n\n`;
  md += `## Abstract\nFirmware-facing specification for logical LSN v0.1 parameters.\nAll hardware and CIP mappings are currently TBD and await physical validation.\n\n`;
  
  md += `> Simulation validation status is test-harness evidence only and does not imply firmware implementation or hardware validation.\n\n`;
  md += `| Symbolic Name | Direction | Type | Access | CIP Service | Class | Instance | Attribute | Assembly | Firmware Status | Simulation Status | Expected Firmware Behavior | Expected Reported Response | Notes |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  
  profile.forEach(item => {
    const cell = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    md += `| **${cell(item.symbolicName)}** | ${cell(item.direction)} | ${cell(item.dataType)} | ${cell(item.access)} | ${cell(item.cipService)} | ${cell(item.class)} | ${cell(item.instance)} | ${cell(item.attribute)} | ${cell(item.assembly)} | ${cell(effectiveFirmwareStatus(item))} | ${cell(item.simulationStatus)} | ${cell(item.expectedFirmwareBehavior)} | ${cell(item.expectedReportedResponse)} | ${cell(item.notes)} |\n`;
  });
  
  return md;
}

export function generateHTMLReport(tests: any[], device: any, timestamp: number): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>LSN Validation Report</title>
      <style>
        body { font-family: monospace; color: #333; line-height: 1.5; padding: 20px; }
        h1 { color: #000; border-bottom: 2px solid #ccc; padding-bottom: 10px; }
        .metadata { margin-bottom: 30px; background: #f5f5f5; padding: 15px; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background: #eaeaea; }
        .pass { color: green; font-weight: bold; }
        .fail { color: red; font-weight: bold; }
        .warn { color: orange; font-weight: bold; }
        .disclaimer { border: 1px solid red; padding: 10px; color: red; font-weight: bold; text-align: center; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="disclaimer">
        DISCLAIMER: SIMULATION EVIDENCE IS NOT PHYSICAL VALIDATION. ALL HARDWARE MODES AWAITING FIRMWARE IMPLEMENTATION.
      </div>
      <p><strong>Validation scope:</strong> SIMULATION TEST HARNESS. Test success does not change firmware implementation status.</p>
      <h1>LSN Validation Report</h1>
      <div class="metadata">
        <p><strong>Device:</strong> ${device.name} (${device.product})</p>
        <p><strong>Firmware:</strong> ${device.firmware}</p>
        <p><strong>Profile:</strong> ${device.profile}</p>
        <p><strong>Timestamp:</strong> ${new Date(timestamp).toISOString()}</p>
      </div>
      <table>
        <tr>
          <th>Test Name</th>
          <th>Category</th>
          <th>Expected Behavior</th>
          <th>Actual Evidence</th>
          <th>Status</th>
        </tr>
        ${tests.map(t => `
          <tr>
            <td>${t.name}</td>
            <td>${t.category}</td>
            <td>${t.expected}</td>
            <td>${t.evidence || '-'}</td>
            <td class="${t.status === 'passed' ? 'pass' : t.status === 'failed' ? 'fail' : 'warn'}">${t.status.toUpperCase()}</td>
          </tr>
        `).join('')}
      </table>
    </body>
    </html>
  `;
}
