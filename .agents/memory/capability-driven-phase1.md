---
name: Capability-driven Phase 1
description: Governs how future hardware capabilities appear in the LSN console.
---

Future hardware capabilities such as monitored interlocks, remote stop, and sensors must default to disabled in the Phase 1 profile and remain absent from normal fields, controls, tests, status, and exports. They may appear only in a clearly labeled Developer Simulation opt-in area.

**Why:** Phase 1 firmware support is capability-limited. Treating future inputs as normal interface fields makes the console advertise and validate behavior that the active firmware contract does not support.

**How to apply:** Tag capability-dependent fields and tests in profile-derived data, filter every user-facing and exported surface through the active capability model, and keep experimental opt-ins simulation-only.