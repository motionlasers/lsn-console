---
name: Deterministic stress timing
description: Integrity rules for simulated stress timing, counters, deadlines, and final results.
---

Stress runtime evidence must be partitioned across phase boundaries and accrue only while the simulated output is actually active. Failed or blocked ON attempts never contribute runtime or enable-count increments.

**Why:** Whole-tick accounting and attempted-state accounting can create plausible but false runtime evidence, especially when one tick crosses several phases or a response is dropped.

**How to apply:** Require live telemetry at start and throughout the run; telemetry loss must terminate safely. Establish an inactive baseline, count only real transitions, cap phase slices at the duration budget, credit exact-deadline completion, and PASS only clean requested-cycle completion.