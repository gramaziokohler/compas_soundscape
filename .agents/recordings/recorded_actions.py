"""
Recorded browser actions — replay with:
    python .agents/recordings/recorded_actions.py
"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')

    # --- pre-recording actions (from prior session) ---
    # Click Soundscape button to expand panel
    page.locator('button:has-text("Soundscape"):not(:has-text("Collapse"))').click()
    page.wait_for_timeout(300)

    # Click "Add sound" button
    page.locator('button[aria-label="Add sound"], button:has-text("Add sound")').click()
    page.wait_for_timeout(300)

    # Click "Catalog Sound"
    page.locator('button:has-text("Catalog Sound")').click()
    page.wait_for_timeout(300)

    # --- start of live recording ---

    # TODO: recorded actions will be appended here
