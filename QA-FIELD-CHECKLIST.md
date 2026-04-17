# ROTC Field QA Checklist

Use this checklist before deployment to ensure scanning, records, and offline behavior are stable in field conditions.

## Device Layout Targets

- `320dp` small phone (older Android)
- `360dp` compact phone (common)
- `412dp` large phone
- `>=768dp` tablet

## Test Setup (All Devices)

- Log in once online using real `admin` and `officer` accounts.
- Turn `Strict field mode` ON in `Settings`.
- Prepare:
  - 10 valid QR codes (unique cadets)
  - 2 duplicate QR scans
- Keep one test condition with unstable/no signal for reconnect checks.

## Pass/Fail Checks Per Device

### 1) Login + Settings

- Open `Settings` from both officer and admin screens.
- Toggle `Strict field mode` ON/OFF.
- Restart app and verify toggle state persists.
- Verify status labels show correct mode/network.

### 2) Core Scan Flow (Critical)

- Scan 10 unique QR codes consecutively.
- Verify each scan gives clear success feedback.
- Scan duplicate QR and verify duplicate handling (not false success).
- Confirm app does not freeze, crash, or force restart.

### 3) Records / Results Visibility

- Open results/view records after scans.
- Verify name, ID, time, and status are correct.
- Pull-to-refresh and verify data remains accessible.
- Confirm no blank/error-only state.

### 4) Offline Stability

- Turn on airplane mode.
- Verify app remains usable with no scary technical popups.
- Attempt scans offline and confirm expected field-mode behavior.

### 5) Reconnect + Sync Integrity

- Perform scans while offline.
- Restore data/Wi-Fi.
- Verify records sync without missing or duplicate entries.
- Compare manual scan count versus app/backend totals.

### 6) Responsive UI Safety

- All key buttons are tappable (`Settings`, `Logout`, `Scan`, `Results`).
- No clipped text in headers, tiles, and status badges.
- Bottom tab does not cover list content.
- Tablet layout remains centered/readable and not overly stretched.

## Go/No-Go Rule

Deploy only if all are true:

- 30+ continuous scans complete with zero crash.
- Offline-to-online cycle shows zero missing records.
- Duplicate handling is consistent.
- Officers can access `Settings` any time.
- No critical clipping across `320dp`, `360dp`, `412dp`, and tablet.

## Field Bug Report Template

- Device model:
- Android version:
- Screen class (`320 / 360 / 412 / tablet`):
- Role used (`admin / officer`):
- Mode (`online / offline / strict field mode`):
- Steps performed:
- Expected result:
- Actual result:
- Screenshot/video:
- Time of incident:
