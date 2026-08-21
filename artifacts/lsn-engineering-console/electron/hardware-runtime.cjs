'use strict';

const HARDWARE_RUNTIME_ERROR =
  'Physical EtherNet/IP is available only in the packaged Windows desktop app.';

function isPhysicalHardwareRuntime(runtime) {
  return runtime?.isPackaged === true && runtime?.platform === 'win32';
}

function assertPhysicalHardwareRuntime(runtime) {
  if (!isPhysicalHardwareRuntime(runtime)) {
    throw new Error(HARDWARE_RUNTIME_ERROR);
  }
}

module.exports = {
  HARDWARE_RUNTIME_ERROR,
  isPhysicalHardwareRuntime,
  assertPhysicalHardwareRuntime,
};