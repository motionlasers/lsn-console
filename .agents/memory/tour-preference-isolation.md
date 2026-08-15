---
name: Tour preference isolation
description: Keeps page-scoped guide exits independent from the persisted full-tour dismissal choice.
---

Page-scoped guide completion, close, Escape, and Skip must preserve the user’s existing full-tour dismissal preference. Only ending a full tour may update that preference.

**Why:** A page guide has no dismissal-preference control. Treating its normal close as a full-tour dismissal choice can silently re-enable the automatic full walkthrough on the next app mount.

**How to apply:** Any new tour mode should separate transient exit state from persisted full-tour preferences, and reload validation should confirm one mode cannot alter another mode’s saved choice.