const { version } = require('./package.json');

module.exports = {
  packagerConfig: {
    name: 'LSN Engineering Console',
    executableName: 'LSN-Engineering-Console',
    asar: true,
    // The renderer is fully bundled by Vite; packaged runtime code only uses
    // Electron built-ins, so build/test dependencies must not enter the ASAR.
    ignore: [/^\/node_modules(?:\/|$)/],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'LSN_Engineering_Console',
        // Tagged CI releases provide a protected PFX and password. Local
        // packaging can omit them, but the release workflow fails closed.
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE || undefined,
        certificatePassword:
          process.env.WINDOWS_CERTIFICATE_PASSWORD || undefined,
        setupExe: `LSN-Engineering-Console-Setup-${version}-dev.exe`,
        authors: 'Saber Industrial Applications',
        description: 'Engineering and firmware validation console for Laser Safety Network hardware',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};