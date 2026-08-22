---
name: Windows profile-smoke trust
description: Hosted-Windows CA trust and evidence-boundary constraints for the installed profile publication smoke.
---

Do not mutate the Windows Current User Root store for the profile publication
fixture. Supply the fixture CA through `NODE_EXTRA_CA_CERTS` before Electron
starts and allow Node fetch only behind the complete packaged-Windows,
GitHub-Actions, explicit-smoke-marker, `RUNNER_TEMP` CA, exact HTTPS localhost
origin guard. Production profile and auth networking must retain Electron's
normal verified transports.

**Why:** Both `certutil` and PowerShell `Import-Certificate` can block
indefinitely on hosted Windows runners. A global TLS bypass would weaken
production semantics, while the guarded Node path gives the fixture bounded,
process-scoped trust without changing production certificate validation.

**How to apply:** Keep every activation condition independently tested, reject
all off-origin requests, and source installed-smoke assertions from the
sanitized preload IPC state. Treat scalar mapping-diff values as serialized
strings; use renderer screenshots as context rather than as the state oracle.