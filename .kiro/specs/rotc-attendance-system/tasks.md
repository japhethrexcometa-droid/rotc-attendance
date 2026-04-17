# Implementation Plan: ROTC Attendance System

## Overview

Full implementation of the ROTC Attendance System on top of the existing Expo Router shell. Tasks proceed from infrastructure (dependencies, DB migration, seed data) through service layer (auth, sessions, scanning, offline, import, reports, digital ID) to UI wiring (all screens and components). Each task builds on the previous and ends with everything integrated.

## Tasks

- [x] 1. Install missing dependencies and verify existing ones
  - Run `npx expo install react-native-qrcode-svg @react-native-community/netinfo expo-sharing`
  - Confirm `react-native-svg` is already present (required peer dep for qrcode-svg)
  - Confirm `expo-crypto`, `expo-camera`, `xlsx`, `@react-native-async-storage/async-storage` are present
  - _Requirements: 7.1, 4.1, 7.4_

- [x] 2. Database migration — extend schema and add new tables
  - [x] 2.1 Create migration file `supabase/migrations/20260413000001_extend_schema.sql`
    - Add columns to `users`: `gender TEXT CHECK (gender IN ('Male','Female','Other'))`, `photo_url TEXT`, `is_active BOOLEAN DEFAULT TRUE`, `updated_at TIMESTAMPTZ DEFAULT NOW()`
    - Add columns to `sessions`: `start_time TIME NOT NULL DEFAULT '07:00'`, `late_time TIME NOT NULL DEFAULT '07:15'`, `cutoff_time TIME NOT NULL DEFAULT '08:00'`, `created_by UUID REFERENCES public.users(id)`
    - Alter `sessions.status` CHECK to `('OPEN','CLOSED')` (was `'active','closed'`)
    - Alter `attendance.status` CHECK to `('present','late','absent','excused')` (was `'present','late','error'`)
    - Add column `attendance.notes TEXT`
    - Create `announcements` table: `id UUID PK`, `title TEXT NOT NULL`, `body TEXT NOT NULL`, `created_by UUID REFERENCES users(id)`, `created_at TIMESTAMPTZ DEFAULT NOW()`
    - Enable RLS on `announcements`
    - _Requirements: 2.7, 9.2, 10.1, 11.2_
  - [x] 2.2 Update RLS policies in the same migration file
    - Drop old permissive policies on `users`, `sessions`, `attendance`
    - Add `users` policy: SELECT allowed for all (public digital-id portal needs it); INSERT/UPDATE/DELETE restricted to admin role check via `current_setting`
    - Add `sessions` policy: SELECT for all; INSERT/UPDATE/DELETE only when `current_setting('app.user_role', true) = 'admin'`
    - Add `attendance` policy: SELECT for all; INSERT when role is admin or officer; UPDATE only admin
    - Add `announcements` policy: SELECT for all; INSERT/UPDATE/DELETE only admin
    - _Requirements: 11.2, 11.3, 11.4, 11.5_
  - [x] 2.3 Create Supabase Storage bucket `cadet-photos`
    - Add SQL in migration: `INSERT INTO storage.buckets (id, name, public) VALUES ('cadet-photos', 'cadet-photos', true) ON CONFLICT DO NOTHING`
    - Add storage policy allowing authenticated inserts and public reads
    - _Requirements: 7.3_

- [x] 3. Seed admin account
  - Create migration file `supabase/migrations/20260413000002_seed_admin.sql`
  - Insert admin user: `id_number = 'admin'`, `full_name = 'S1 Admin'`, `role = 'admin'`, `is_active = true`
  - Set `password_hash` to the SHA-256 hex of `'admin123'` (value: `240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9`)
  - Set a fixed `qr_token` for admin (SHA-256 of `'admin-token'`)
  - Use `ON CONFLICT (id_number) DO NOTHING` to be idempotent
  - _Requirements: 1.1, 1.3_

- [x] 4. Implement `lib/auth.ts` — AuthService
  - [x] 4.1 Create `lib/auth.ts` with `hashPassword`, `login`, `logout`, `getSession`
    - `hashPassword(plain)`: use `expo-crypto` `digestStringAsync` with SHA256; return 64-char lowercase hex
    - `login(idNumber, password)`: hash password, query `users` table for matching `id_number` + `password_hash`, return `AuthResult`
    - On success: set `current_setting` header on supabase client for RLS (`app.user_id`, `app.user_role`) and persist `UserSession` to AsyncStorage key `rotc_user_session`
    - `logout()`: clear AsyncStorage key, reset supabase headers
    - `getSession()`: read and parse `UserSession` from AsyncStorage; return null if missing or malformed
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ]\* 4.2 Write property test for `hashPassword` determinism (Property 1)
    - **Property 1: Password Hashing Determinism**
    - Use `fast-check` to generate arbitrary non-empty strings; assert `hashPassword(x) === hashPassword(x)` and result length is 64
    - **Validates: Requirements 1.3, 11.1**

- [x] 5. Implement `lib/session-manager.ts` — SessionManager
  - [x] 5.1 Create `lib/session-manager.ts` with `createSession`, `closeSession`, `getOpenSession`, `autoMarkAbsents`
    - `createSession(params)`: INSERT into `sessions`; surface unique constraint error as user-friendly message
    - `getOpenSession(date, type)`: SELECT from `sessions` WHERE `session_date = date AND session_type = type AND status = 'OPEN'`
    - `closeSession(sessionId)`: UPDATE `sessions` SET `status = 'CLOSED'`; then call `autoMarkAbsents(sessionId)`
    - `autoMarkAbsents(sessionId)`: SELECT all active cadets; SELECT already-attended cadet IDs for session; batch INSERT absent records for the difference using `ON CONFLICT DO NOTHING`; return count inserted
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [ ]\* 5.2 Write property test for `autoMarkAbsents` idempotence (Property 6)
    - **Property 6: autoMarkAbsents Idempotence**
    - Mock Supabase responses; assert calling twice does not increase total attendance record count
    - **Validates: Requirements 2.5**
  - [ ]\* 5.3 Write property test for `autoMarkAbsents` completeness (Property 5)
    - **Property 5: autoMarkAbsents Completeness**
    - For any set of active cadets and any subset already scanned, assert every cadet has exactly one record after the call
    - **Validates: Requirements 2.4**

- [x] 6. Implement `lib/qr-scan-service.ts` — QRScanService
  - [x] 6.1 Implement `resolveAttendanceStatus(scanTime, session): AttendanceStatus`
    - Parse `session.late_time` and `session.cutoff_time` as HH:MM; convert to minutes-since-midnight
    - Return `'blocked'` if `scanMinutes >= cutoffMinutes`; `'late'` if `scanMinutes >= lateMinutes`; else `'present'`
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]\* 6.2 Write property tests for `resolveAttendanceStatus` (Properties 2, 3, 4)
    - **Property 2: Present Window** — scanTime before late_time → always `'present'`
    - **Property 3: Late Window** — scanTime in [late_time, cutoff_time) → always `'late'`
    - **Property 4: Blocked Window** — scanTime >= cutoff_time → always `'blocked'`
    - Use `fast-check` to generate valid HH:MM pairs and scan times in each window
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [x] 6.3 Implement `processQRScan(params): Promise<ScanResult>`
    - Lookup `qr_token` in `users` table; return `invalid/bad_token` if not found
    - Return `invalid/self_scan` if found user ID equals `scannedBy`
    - Check for open session; return `invalid/no_open_session` if none
    - Check existing attendance record; return `duplicate` if found
    - Call `resolveAttendanceStatus`; return `blocked` if blocked
    - If online: INSERT attendance record with `scanned_by`; if offline: call `OfflineSyncService.enqueue`
    - Return `present` or `late` outcome with cadet info and timestamp
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 7. Implement `lib/offline-sync.ts` — OfflineSyncService
  - [x] 7.1 Create `lib/offline-sync.ts` with `enqueue`, `syncPending`, `getPendingCount`, `clearSynced`
    - `enqueue(record)`: read queue from AsyncStorage key `rotc_offline_queue`; push new record with `synced: false`; write back
    - `getPendingCount()`: read queue; return count where `synced === false`
    - `syncPending()`: read queue; for each unsynced record, upsert to `attendance` with `onConflict: 'cadet_id,session_id'`; mark `synced: true` on success; collect errors; write queue back; return `SyncResult`
    - `clearSynced()`: filter out records where `synced === true`; write back
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 7.2 Add NetInfo connectivity listener in `lib/offline-sync.ts`
    - Import `NetInfo` from `@react-native-community/netinfo`
    - Export `startSyncListener()`: subscribe to NetInfo; on `isConnected === true`, call `syncPending()` automatically
    - _Requirements: 4.2, 12.2_
  - [ ]\* 7.3 Write property test for offline queue sync idempotence (Property 7)
    - **Property 7: Offline Queue Sync Idempotence**
    - Mock Supabase upsert; assert calling `syncPending` twice does not re-submit already-synced records
    - **Validates: Requirements 4.3**

- [x] 8. Implement `lib/import-service.ts` — ImportService
  - [x] 8.1 Create `lib/import-service.ts` with `parseExcel`, `generateCredentials`, `batchUpsert`
    - `parseExcel(fileUri)`: read file as base64 via `expo-file-system`; parse with `xlsx`; map rows to `ExcelRow`; skip rows missing `ID Number` or `Full Name`; return `ParsedCadet[]`
    - `generateCredentials(row)`: compute raw password as `row.full_name.substring(0,3).toUpperCase() + row.id_number.slice(-4)`; hash with SHA-256; generate `qr_token` as SHA-256 of `idNumber + Date.now()`; return `CadetCredentials`
    - `batchUpsert(cadets, batchSize=500)`: split into chunks; upsert each chunk to `users` with `onConflict: 'id_number'`; accumulate `ImportResult`
    - Include `gender` field mapping from Excel column `Gender`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - [ ]\* 8.2 Write property test for credential format (Property 8)
    - **Property 8: Import Credential Format**
    - Generate arbitrary valid name + ID pairs; assert raw password format and `password_hash` length === 64
    - **Validates: Requirements 5.2, 5.3**
  - [ ]\* 8.3 Write property test for QR token uniqueness (Property 9)
    - **Property 9: Import QR Token Uniqueness**
    - Generate batch of distinct ID numbers; assert all resulting `qr_token` values are unique
    - **Validates: Requirements 5.6**
  - [ ]\* 8.4 Write property test for import skipping invalid rows (Property 10)
    - **Property 10: Import Skips Invalid Rows**
    - Generate mixed arrays of valid and invalid rows; assert parsed count equals valid-row count
    - **Validates: Requirements 5.1, 5.2**

- [x] 9. Implement `lib/digital-id-service.ts` — DigitalIDService
  - [x] 9.1 Create `lib/digital-id-service.ts` with `getCadetByIdOrName`, `uploadPhoto`, `getShareableLink`
    - `getCadetByIdOrName(query)`: SELECT `id, id_number, full_name, platoon, year_level, qr_token, photo_url, is_active` FROM `users` WHERE `full_name ILIKE '%query%' OR id_number ILIKE '%query%'` AND `role = 'cadet'`
    - `uploadPhoto(cadetId, imageUri)`: read image as base64; upload to Supabase Storage bucket `cadet-photos` at path `{cadetId}.jpg`; UPDATE `users` SET `photo_url = publicUrl` WHERE `id = cadetId`; return public URL
    - `getShareableLink(cadetId)`: return `https://{appUrl}/digital-id?id={cadetId}`
    - _Requirements: 7.2, 7.3, 7.5, 7.6, 11.6_

- [x] 10. Implement `lib/reports-service.ts` — ReportsService
  - [x] 10.1 Create `lib/reports-service.ts` with `getAttendanceReport` and `exportToExcel`
    - `getAttendanceReport(filters)`: JOIN `attendance` + `sessions` + `users`; apply `startDate`/`endDate` filter on `session_date`; apply `platoon` filter; apply `searchQuery` ILIKE on `full_name` or `id_number`; map to `AttendanceRow[]` with score computed from status
    - Score mapping: `present=1.0`, `late=0.75`, `absent=0.0`, `excused=0.0`
    - `exportToExcel(rows)`: use `xlsx` to build workbook with columns: ID Number, Full Name, Platoon, Session Date, Session Type, Status, Score, Scan Time; write to `FileSystem.cacheDirectory`; return file URI
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ]\* 10.2 Write property test for attendance score mapping (Property 12)
    - **Property 12: Attendance Score Mapping**
    - For each valid status value, assert score is exactly the specified value; assert no status maps outside the set
    - **Validates: Requirements 8.2**
  - [ ]\* 10.3 Write property test for cadet standing derivation (Property 11)
    - **Property 11: Cadet Standing Derivation**
    - Generate arbitrary absence counts; assert standing thresholds: [0,2]→Active, [3,4]→Warning, ≥5→Drop; assert no count maps to multiple standings
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [ ] 11. Checkpoint — Verify service layer
  - Ensure all lib files compile without TypeScript errors
  - Ensure all non-optional property tests pass
  - Ask the user if questions arise before proceeding to UI.

- [x] 12. Wire `app/index.tsx` — real login with AuthService
  - Import `AuthService` from `lib/auth`
  - Replace mock `handleLogin` with `AuthService.login(userId, password)`
  - On `success: true`: route to `/admin`, `/officer`, or `/cadet` based on `user.role`
  - On `success: false`: show Alert with `"Invalid credentials. Please try again."`
  - On app mount: call `AuthService.getSession()`; if session exists, skip login and route directly
  - _Requirements: 1.1, 1.2, 1.4, 1.6_

- [x] 13. Implement Admin Home tab with live stats
  - In `app/admin.tsx`, replace hardcoded stats with Supabase queries on Home tab mount:
    - Total cadets: `SELECT count(*) FROM users WHERE role='cadet' AND is_active=true`
    - Today present: `SELECT count(*) FROM attendance JOIN sessions ON ... WHERE session_date=today AND status IN ('present','late')`
    - At-risk: cadets with 3+ absences
  - Replace "No Active Session" card with live query for today's open sessions (AM/PM)
  - Load `UserSession` from AsyncStorage to display admin name in header
  - _Requirements: 9.4_

- [x] 14. Implement Admin Cadets tab — CRUD + search
  - In `app/admin.tsx`, replace "Coming Soon: Cadets" with a full Cadets tab:
    - `FlatList` of all cadets from `users` WHERE `role='cadet'`; use `keyExtractor` and `getItemLayout`
    - Search bar with 300ms debounce filtering by `full_name` or `id_number` via Supabase ILIKE
    - Platoon filter dropdown
    - Tap cadet row → modal/sheet with editable fields: `full_name`, `platoon`, `year_level`, `gender`, `is_active`
    - Save button calls UPDATE on `users`; Cancel dismisses
    - Toggle `is_active` to deactivate cadet
    - _Requirements: 9.1, 9.2, 9.3, 12.3, 12.4_

- [x] 15. Implement Admin Sessions tab — create/close form
  - In `app/admin.tsx`, replace "Coming Soon: Sessions" with Sessions tab:
    - Form fields: Session Type (AM/PM picker), Date (default today), Start Time, Late Time, Cutoff Time (HH:MM inputs)
    - "Create Session" button calls `SessionManager.createSession()`; show success or error alert
    - List of today's sessions (open and closed) with status badge
    - "Close Session" button on open sessions calls `SessionManager.closeSession()`; confirm dialog first
    - Show count of absent records inserted after close
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7_

- [x] 16. Update `components/ScannerView.tsx` — real QR token validation
  - Accept props: `session: Session | null`, `scannedBy: string` (officer/admin user ID)
  - Replace mock `handleBarcodeScanned` logic with `QRScanService.processQRScan({ qrToken: data, session, scannedBy })`
  - Map `ScanResult.outcome` to feedback banner:
    - `present` → green banner with cadet name + "RECORDED PRESENT"
    - `late` → orange banner with cadet name + "RECORDED LATE"
    - `duplicate` → orange banner "Already recorded for this session"
    - `blocked` → red banner "Session closed. Cannot record attendance."
    - `invalid/bad_token` → red banner "Invalid QR Code"
    - `invalid/self_scan` → red banner "You cannot scan your own QR code."
    - `invalid/no_open_session` → red banner "No active session. Contact your officer."
  - Show pending offline count badge (call `OfflineSyncService.getPendingCount()` after each scan)
  - Show yellow "Saved offline – will sync" indicator when scan was queued offline
  - _Requirements: 3.1–3.9, 4.1, 4.5_

- [x] 17. Wire Admin Scanner tab with real session context
  - In `app/admin.tsx` Scanner tab: fetch today's open session before rendering `ScannerView`
  - Pass `session` and `scannedBy` (admin user ID from AsyncStorage) as props to `ScannerView`
  - Show "No open session — create one in Sessions tab" message if no open session found
  - _Requirements: 3.7_

- [x] 18. Update `components/ImportView.tsx` — add gender field
  - Add `Gender` to the "Required Excel Fields" card (mark as Optional)
  - Replace inline import logic with calls to `ImportService.parseExcel()` and `ImportService.batchUpsert()`
  - Show `ImportResult` summary alert: total, inserted, updated, skipped, errors
  - _Requirements: 5.8, 5.10_

- [x] 19. Implement Admin Reports tab
  - In `app/admin.tsx`, replace "Coming Soon: Reports" with Reports tab:
    - Filter bar: Start Date, End Date (date pickers), Platoon dropdown, Search text input (300ms debounce)
    - "Generate Report" button calls `ReportsService.getAttendanceReport(filters)`
    - `FlatList` displaying results: cadet name, session date/type, status badge, score
    - "Export to Excel" button calls `ReportsService.exportToExcel(rows)` then `expo-sharing` `shareAsync(fileUri)`
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 12.3_

- [x] 20. Implement Admin Announcements (within Home or dedicated section)
  - Add "Post Announcement" form on Admin Home tab (title + body text inputs + submit button)
  - On submit: INSERT into `announcements` with `created_by` from session
  - Show last 3 announcements on Home tab as preview cards
  - _Requirements: 10.1, 10.3_

- [x] 21. Implement `app/officer.tsx` — Scanner + Results tabs
  - Replace stub with a two-tab layout (Scanner, Results) using the same bottom tab pattern as admin
  - Scanner tab: fetch today's open session; render `ScannerView` with officer's user ID as `scannedBy`
  - Results tab: read-only `FlatList` of today's attendance for the officer's platoon
    - Query: `attendance JOIN sessions JOIN users WHERE session_date=today AND users.platoon = officer.platoon`
    - Show cadet name, status badge, scan time
  - Load officer `UserSession` from AsyncStorage for header name and platoon
  - Logout button clears session and navigates to `/`
  - _Requirements: 3.1–3.9, 6.7_

- [x] 22. Implement `app/cadet.tsx` — real Supabase data
  - Load `UserSession` from AsyncStorage on mount; if null, redirect to `/`
  - Today's AM/PM status: query `attendance JOIN sessions WHERE cadet_id=session.id AND session_date=today`
  - History counts: aggregate `present`, `late`, `absent` counts from all attendance records for this cadet
  - Derive standing from absence count using thresholds (0-2 Active, 3-4 Warning, 5+ Drop)
  - Announcements section: query `announcements ORDER BY created_at DESC LIMIT 10`
  - Logout button clears session and navigates to `/`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 10.2_

- [x] 23. Implement `app/digital-id.tsx` — real QR code and cadet data
  - [x] 23.1 Replace `<QrCode>` icon with real `<QRCode>` from `react-native-qrcode-svg`
    - Load cadet's `qr_token` from `UserSession` (when accessed from cadet app) or from `DigitalIDService.getCadetByIdOrName` (public portal)
    - Pass `qr_token` as `value` prop to `<QRCode size={120} />`
    - _Requirements: 7.1_
  - [x] 23.2 Load real cadet data from Supabase
    - On mount: check for `UserSession` in AsyncStorage; if present, load own cadet data
    - If accessed via URL param `?id=`, load that cadet's public data via `DigitalIDService.getCadetByIdOrName`
    - Populate name, ID number, platoon, academic year, status from live data
    - _Requirements: 7.5, 7.6_
  - [x] 23.3 Wire photo upload to Supabase Storage
    - Replace local `setPhotoUri` state with `DigitalIDService.uploadPhoto(cadetId, imageUri)`
    - After upload, update displayed photo from returned `photo_url`
    - _Requirements: 7.3_
  - [x] 23.4 Implement Download / Save Image button
    - Use `expo-file-system` + `expo-sharing` `shareAsync()` to share the ID card
    - Capture the ID card `View` as an image using `react-native-view-shot` or `expo-print` (use `expo-sharing` for the share sheet)
    - _Requirements: 7.4_

- [x] 24. Add public search portal to `app/digital-id.tsx`
  - Add a search bar at the top when no `UserSession` is present (public mode)
  - On search submit: call `DigitalIDService.getCadetByIdOrName(query)`; display results list
  - Tap result to view that cadet's full ID card
  - _Requirements: 7.2, 7.6_

- [x] 25. Start offline sync listener in app root
  - In `app/_layout.tsx`, import and call `startSyncListener()` from `lib/offline-sync` on app mount
  - This ensures the NetInfo listener is active for the entire app session
  - _Requirements: 4.2, 12.2_

- [ ] 26. Checkpoint — Full integration test
  - Ensure all screens compile and render without errors
  - Verify login → admin/officer/cadet routing works with real Supabase data
  - Verify QR scan flow end-to-end (create session → scan → see attendance record in Supabase)
  - Verify import flow with a sample Excel file including Gender column
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` library — install with `npm install --save-dev fast-check` before running tests
- The design document's Correctness Properties section is the authoritative source for all property test definitions
- RLS policies use `current_setting('app.user_role', true)` — the auth service must set this via `supabase.rpc` or custom headers on each client request; for the initial implementation, the permissive policies can remain and be tightened incrementally
- `react-native-view-shot` may be needed for task 23.4 — install with `npx expo install react-native-view-shot` if the `expo-print` approach is insufficient
