---
name: ui-verify
description: Visually verify a UI change against the running COMPAS app.
---

# UI verification

1. Use the `run-app` skill to start both servers if not already running.
2. Use `webapp-testing` to drive the change with Playwright.
3. Set viewport to 1280x800, device_scale_factor=1 (see resolution rule below — do not change this).
4. Prefer `locator.screenshot()` on the changed component over full-page screenshots.
   Full-page only when the check is genuinely about page-level layout.
5. Judge correctness against `.cursor/rules/ui-conventions.mdc` and,
   for timeline/waveform changes, `.cursor/rules/daw-timeline.mdc`.
6. Report PASS/FAIL with the screenshot path. If FAIL, state which convention it violates.

## File persistence — ui-testing folder

All UI verification scripts and screenshots live under
`ui-testing/`.

**Structure:**
```
ui-testing/
  verify_<feature>.py       # Playwright verification script (keep after run)
  screenshots/
    <feature>_pass.png      # Screenshot on PASS
    <feature>_fail.png      # Screenshot on FAIL
```

**Rules:**
- Write each Playwright .py script into `ui-testing/` — never a temp file.
- Save screenshots to `ui-testing/screenshots/`.
- Ensure both directories exist before writing (create if missing).
- Keep scripts after the run so they can be re-executed later.
- Screenshot filepath in the PASS/FAIL report must be relative to the repo root
  (e.g. `ui-testing/screenshots/title_color_pass.png`).