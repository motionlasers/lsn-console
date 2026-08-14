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
        // Unsigned Development Preview installer; the -dev suffix marks the
        // internal-development release channel.
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