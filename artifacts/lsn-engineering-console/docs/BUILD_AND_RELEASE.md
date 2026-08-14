# Build and Release

## Web simulation

Run the managed Replit workflow for `@workspace/lsn-engineering-console`.

## Desktop

The Electron main process owns all future TCP/UDP and maintenance networking. The renderer has no Node integration and accesses only the narrow preload API.

Windows builds are produced by `.github/workflows/lsn-console-windows.yml`. Release artifacts are a Squirrel installer named `LSN-Engineering-Console-Setup-x.y.z.exe` and an optional ZIP.