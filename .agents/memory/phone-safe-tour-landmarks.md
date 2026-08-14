---
name: Phone-safe tour landmarks
description: How to choose guided-tour targets that remain visible and non-overlapping on narrow screens.
---

Guided-tour steps must target compact headings, action rows, or similarly bounded landmarks near the top of a page. Do not target an entire tall card or a section that can fall below the fold.

**Why:** On narrow screens with the console navigation expanded, tall or lower-page targets can remain offscreen or leave no valid coachmark placement, causing the dialog to overlap the highlight or the highlight to become meaningless.

**How to apply:** For every new tour step, verify the target rectangle and coachmark have zero overlap at a phone viewport. Prefer a page heading or card header when the section body can grow vertically.