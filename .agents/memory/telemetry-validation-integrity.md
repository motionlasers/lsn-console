---
name: Telemetry and validation integrity
description: Rules for presenting disconnected device data and separating simulator evidence from firmware implementation.
---

Device values may be presented as current only while telemetry is live. After disconnect, timeout, communication loss, reload, or stale age, preserve values only as explicitly labeled last-reported evidence and render the current state as UNKNOWN or STALE.

**Why:** An engineering console must never imply knowledge of a physical or simulated device's current state after the underlying telemetry is no longer valid.

**How to apply:** Gate live badges, controls, counters, diagnostics, firmware/device metadata, and exports through the shared telemetry-freshness model. Never show green ACTIVE, TRUE, READY, or healthy indicators for non-live data.

Firmware implementation status and simulation validation status are independent. Unresolved protocol mappings force firmware status to TBD, even when legacy cached data or simulator tests say VERIFIED.

**Why:** Deterministic simulator coverage is useful evidence but does not prove that WT32-ETH01 firmware, CIP mappings, or physical hardware behavior exists or has been validated.

**How to apply:** Keep separate firmware and simulation fields in profiles, UI, reports, exports, and handoff checklists. Hardware transmission stays locked until mappings and firmware validation are real.

Guided timing evidence must compare an actual monotonic PC measurement with independently accumulated simulated-device runtime; never compare a configured duration to itself.

**Why:** A deterministic zero difference can look like validation while proving only that the same input value was copied into both sides of the comparison.

**How to apply:** Wait for the requested interval, measure elapsed PC time, keep exactly one runtime-accrual owner during the test, and retain a failure path when output activation or timing diverges.