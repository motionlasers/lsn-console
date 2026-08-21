---
name: Windows CI — native binary and Squirrel setup
description: What it takes to get a pnpm monorepo Electron app to build and test on a Windows GitHub Actions runner when the lockfile is generated on Linux.
---

# Windows CI — native binary and Squirrel setup

## The rule
Three separate problems must all be solved for the Windows build to pass:

1. **Platform-native rollup/vite/esbuild/lightningcss/oxide binaries** — pnpm marks Windows-only optional deps as `'-'` in a lockfile generated on Linux. They are never installed by `pnpm install` on the Windows runner either. Fix: a post-install workflow step that uses npm from a clean temp dir (no workspace `.npmrc` or `package.json` in scope) and copies each package individually into the workspace `node_modules`:
   ```yaml
   - name: Install Windows platform-native binaries
     shell: bash
     run: |
       mkdir -p /tmp/win-bins && cd /tmp/win-bins
       npm init -y
       npm install --no-save --ignore-scripts \
         @rollup/rollup-win32-x64-msvc@4.62.3 \
         @rollup/rollup-win32-x64-gnu@4.62.3 \
         lightningcss-win32-x64-msvc@1.32.0 \
         "@tailwindcss/oxide-win32-x64-msvc@4.3.3" \
         @esbuild/win32-x64@0.27.3
       NM="$GITHUB_WORKSPACE/node_modules"
       mkdir -p "$NM/@rollup" "$NM/@esbuild" "$NM/@tailwindcss"
       for pkg in rollup-win32-x64-msvc rollup-win32-x64-gnu; do
         rm -rf "$NM/@rollup/$pkg"; cp -rf "node_modules/@rollup/$pkg" "$NM/@rollup/"
       done
       rm -rf "$NM/lightningcss-win32-x64-msvc"; cp -rf node_modules/lightningcss-win32-x64-msvc "$NM/"
       rm -rf "$NM/@tailwindcss/oxide-win32-x64-msvc"; cp -rf "node_modules/@tailwindcss/oxide-win32-x64-msvc" "$NM/@tailwindcss/"
       rm -rf "$NM/@esbuild/win32-x64"; cp -rf "node_modules/@esbuild/win32-x64" "$NM/@esbuild/"
   ```
   Key pitfalls that were tried and failed:
   - `cp -r node_modules/. "$GITHUB_WORKSPACE/node_modules/"` — fails because pnpm uses symlinks in `.` that can't be overwritten by directories.
   - `--userconfig /tmp/empty` — npm still reads the project `.npmrc`; running from /tmp/win-bins avoids both `.npmrc` and `package.json`.
   - `public-hoist-pattern` in `.npmrc` — only affects placement, not whether the package is installed.
   - `packageExtensions` in `package.json` — pnpm still skips optional bins that don't match the build OS.

2. **electron-winstaller postinstall script** — pnpm v10 ignores build scripts by default. Without `electron-winstaller`'s postinstall, Squirrel's bundled `.exe` helpers are never set up, and the Squirrel maker fails with `Win32Exception: The system cannot find the file specified`. Fix: add to `package.json`:
   ```json
   "pnpm": { "onlyBuiltDependencies": ["electron-winstaller"] }
   ```

3. **C11/C++17 compilation test timeout** — `profile.test.ts` calls `cc`/`c++` as child processes. Windows runners are slow enough that this hits vitest's default 5 s timeout (~11 s observed). Fix: pass `30_000` as the third argument to `it()` for that specific test.

**Why:** All three are silent cross-platform hazards invisible from a Linux dev machine. The lockfile must be regenerated (`pnpm install --no-frozen-lockfile`) after any `package.json` or `.npmrc` change so the `packageExtensionsChecksum` stays current.

## Squirrel installed-app smoke target

Launch the versioned executable under Squirrel's `app-*` directory for
Playwright/Electron smoke tests, not the same-named executable at the install
root.

**Why:** The root executable is a launcher stub. It spawns the versioned app and
exits, so Playwright loses ownership of the launched process and times out even
though the real app opens.

**How to apply:** Target the executable inside the versioned Squirrel
application directory, and close any installer-launched first-run instance
before attaching automation.
