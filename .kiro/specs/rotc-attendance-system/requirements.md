# Requirements Document

## Introduction

The ROTC Attendance System is a mobile-first application for the MSU – Zamboanga Sibugay ROTC Unit. It manages attendance tracking for three roles — Admin (S1 Personnel Officer), Officer (Platoon Leader), and Cadet — using QR-based scanning with AM/PM session logic. The system supports bulk Excel cadet import with auto-credential generation, digital ROTC ID cards with unique QR tokens, offline scan queuing with automatic sync, attendance reporting with Excel export, and a public digital ID portal. It is built on Expo Router (React Native) with a Supabase (PostgreSQL) backend.

---

## Glossary

- **Auth_Service**: The component responsible for login, logout, password hashing, and session persistence.
- **Session_Manager**: The component that creates, monitors, and closes AM/PM attendance sessions.
- **QR_Scan_Service**: The component that validates scanned QR tokens and determines attendance status.
- **Offline_Sync_Service**: The component that queues scans locally when offline and syncs them when connectivity is restored.
- **Import_Service**: The component that parses Excel files and upserts cadet records into the database.
- **Cadet_Dashboard**: The screen that displays a cadet's today attendance, history, standing, and announcements.
- **Digital_ID_Service**: The component that fetches cadet data for ID card display, handles photo upload, and supports public search.
- **Reports_Service**: The component that queries attendance data and exports it to Excel.
- **System**: The ROTC Attendance mobile application as a whole.
- **Admin**: A user with role `admin` (S1 Personnel Officer) who has full system access.
- **Officer**: A user with role `officer` (Platoon Leader) who can scan QR codes and view platoon attendance.
- **Cadet**: A user with role `cadet` who can view their own attendance and digital ID.
- **Session**: A time-bounded attendance window with type AM or PM, defined by `start_time`, `late_time`, and `cutoff_time`.
- **QR Token**: A unique SHA-256 hash assigned to each cadet, embedded in their digital ID QR code.
- **Attendance Status**: One of `present`, `late`, `absent`, or `excused`.
- **Standing**: A cadet's enrollment status derived from absence count: `Active`, `Warning`, or `Drop`.
- **Offline Queue**: A local AsyncStorage list of scan records pending sync to Supabase.
- **Score**: A numeric value assigned to an attendance status for reporting: present=1.0, late=0.75, absent=0.0, excused=0.0.

---

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user (Admin, Officer, or Cadet), I want to log in with my ID number and password, so that I can access my role-specific dashboard securely.

#### Acceptance Criteria

1. WHEN a user submits a valid ID number and password, THE Auth_Service SHALL authenticate the user and route them to their role-based dashboard (`/admin`, `/officer`, or `/cadet`).
2. WHEN a user submits an invalid ID number or password, THE Auth_Service SHALL reject the login and display the message "Invalid credentials. Please try again."
3. THE Auth_Service SHALL hash passwords using SHA-256 via `expo-crypto` before comparing against stored `password_hash` values.
4. WHEN a user successfully logs in, THE Auth_Service SHALL persist the `UserSession` object to AsyncStorage under the key `rotc_user_session`.
5. WHEN a user logs out, THE Auth_Service SHALL remove the `UserSession` from AsyncStorage and navigate to the login screen.
6. WHEN the app launches and a valid `UserSession` exists in AsyncStorage, THE Auth_Service SHALL restore the session and skip the login screen.

---

### Requirement 2: Session Management

**User Story:** As an Admin, I want to create and manage AM/PM attendance sessions with configurable time windows, so that I can control when cadets are marked present, late, or absent.

#### Acceptance Criteria

1. WHEN an Admin creates a session, THE Session_Manager SHALL enforce a unique constraint of one AM session and one PM session per calendar date.
2. IF an Admin attempts to create a duplicate session for the same date and type, THEN THE Session_Manager SHALL reject the request and display an error.
3. WHEN an Admin closes a session, THE Session_Manager SHALL update the session `status` to `CLOSED`.
4. WHEN a session is closed, THE Session_Manager SHALL automatically insert `absent` attendance records for all active cadets (`is_active = true`, `role = 'cadet'`) who have no attendance record for that session.
5. WHEN `autoMarkAbsents` is called on a session that already has absent records, THE Session_Manager SHALL not create duplicate records (idempotent via `ON CONFLICT DO NOTHING`).
6. WHILE a session `status` is `OPEN`, THE Session_Manager SHALL allow new attendance records to be inserted for that session.
7. THE Session_Manager SHALL require `start_time`, `late_time`, and `cutoff_time` fields in HH:MM (24-hour) format when creating a session.

---

### Requirement 3: QR-Based Attendance Scanning

**User Story:** As an Admin or Officer, I want to scan a cadet's QR code to record their attendance, so that I can accurately track who is present, late, or absent for each session.

#### Acceptance Criteria

1. WHEN a valid QR token is scanned and the current time is before `late_time`, THE QR_Scan_Service SHALL record the attendance with status `present`.
2. WHEN a valid QR token is scanned and the current time is at or after `late_time` but before `cutoff_time`, THE QR_Scan_Service SHALL record the attendance with status `late`.
3. WHEN a valid QR token is scanned and the current time is at or after `cutoff_time`, THE QR_Scan_Service SHALL return a `blocked` outcome and not record attendance.
4. WHEN a scanned QR token does not match any user in the database, THE QR_Scan_Service SHALL return an `invalid` outcome with reason `bad_token` and display a red error banner.
5. WHEN a cadet's QR code is scanned a second time in the same session, THE QR_Scan_Service SHALL return a `duplicate` outcome and display an orange banner.
6. WHEN a user scans their own QR code, THE QR_Scan_Service SHALL return an `invalid` outcome with reason `self_scan`.
7. WHEN there is no open session for the current date, THE QR_Scan_Service SHALL return an `invalid` outcome with reason `no_open_session`.
8. WHEN attendance is successfully recorded, THE QR_Scan_Service SHALL display a feedback banner showing the cadet's name, recorded status, and timestamp.
9. THE QR_Scan_Service SHALL store the `scanned_by` user ID on every attendance record as an audit trail.

---

### Requirement 4: Offline Scan Queue and Auto-Sync

**User Story:** As an Officer or Admin, I want attendance scans to be saved locally when offline, so that no scan data is lost due to connectivity issues.

#### Acceptance Criteria

1. WHEN the device has no network connectivity during a scan, THE Offline_Sync_Service SHALL enqueue the scan record to AsyncStorage under the key `rotc_offline_queue` and display a yellow "Saved offline – will sync" indicator.
2. WHEN network connectivity is restored, THE Offline_Sync_Service SHALL automatically flush all pending records from the offline queue to the Supabase `attendance` table.
3. WHEN a record is successfully synced, THE Offline_Sync_Service SHALL mark it as `synced: true` in the local queue and not re-submit it on subsequent sync attempts.
4. WHEN a sync attempt fails for a record, THE Offline_Sync_Service SHALL retain the record in the queue and include the error in the `SyncResult.errors` array.
5. THE Offline_Sync_Service SHALL display the count of pending unsynced records as a badge in the scanner UI.
6. WHEN `syncOfflineQueue` completes, THE Offline_Sync_Service SHALL return a `SyncResult` containing counts of synced and failed records.

---

### Requirement 5: Bulk Excel Cadet Import

**User Story:** As an Admin, I want to import cadets from an Excel file, so that I can provision accounts and QR tokens for an entire platoon without manual data entry.

#### Acceptance Criteria

1. WHEN an Excel file is imported, THE Import_Service SHALL parse all rows that contain both a non-empty `ID Number` and a non-empty `Full Name`.
2. WHEN a row is missing `ID Number` or `Full Name`, THE Import_Service SHALL skip that row and include it in the `ImportResult.errors` list.
3. WHEN generating credentials, THE Import_Service SHALL produce the raw password as `UPPER(fullName[0..2]) + idNumber[-4:]` (first 3 uppercase letters of full name concatenated with last 4 digits of ID number).
4. WHEN generating credentials, THE Import_Service SHALL hash the raw password using SHA-256, producing a 64-character lowercase hex string stored as `password_hash`.
5. WHEN generating credentials, THE Import_Service SHALL generate a unique QR token as the SHA-256 hash of `idNumber + timestamp`.
6. WHEN importing a batch of cadets, THE Import_Service SHALL ensure all generated QR tokens within the batch are distinct.
7. WHEN an imported cadet's `id_number` already exists in the database, THE Import_Service SHALL update the existing record (upsert with `onConflict: 'id_number'`) rather than create a duplicate.
8. THE Import_Service SHALL accept the optional fields `Gender`, `Platoon`, and `Year Level` from the Excel file.
9. THE Import_Service SHALL process imports in batches of up to 500 rows per Supabase request.
10. WHEN import completes, THE Import_Service SHALL return an `ImportResult` with counts of total, inserted, updated, skipped, and errors.

---

### Requirement 6: Cadet Dashboard

**User Story:** As a Cadet, I want to view my attendance status, history, and standing, so that I can monitor my ROTC participation and avoid being dropped.

#### Acceptance Criteria

1. WHEN a cadet views their dashboard, THE Cadet_Dashboard SHALL display today's AM and PM attendance status fetched from the `attendance` table.
2. WHEN a cadet has 0 to 2 absences, THE Cadet_Dashboard SHALL display their standing as `Active`.
3. WHEN a cadet has 3 to 4 absences, THE Cadet_Dashboard SHALL display their standing as `Warning`.
4. WHEN a cadet has 5 or more absences, THE Cadet_Dashboard SHALL display their standing as `Drop`.
5. THE Cadet_Dashboard SHALL display the cadet's attendance history including total present, total late, and total absent counts.
6. WHEN a cadet views their dashboard, THE Cadet_Dashboard SHALL display announcements from the `announcements` table in reverse chronological order.
7. THE Cadet_Dashboard SHALL only display attendance data belonging to the authenticated cadet's own records.

---

### Requirement 7: Digital ROTC ID Portal

**User Story:** As a Cadet, I want to view and download my digital ROTC ID card with a scannable QR code, so that I can present it for attendance scanning without a physical card.

#### Acceptance Criteria

1. WHEN a cadet accesses the Digital ID screen, THE Digital_ID_Service SHALL render the cadet's `qr_token` as a scannable QR code image.
2. WHEN a user searches the public Digital ID portal by name or ID number, THE Digital_ID_Service SHALL return all cadet records where the `full_name` or `id_number` contains the search query (case-insensitive).
3. WHEN a cadet uploads a profile photo, THE Digital_ID_Service SHALL store the image in the Supabase Storage bucket `cadet-photos` and update the cadet's `photo_url` in the `users` table.
4. WHEN a cadet taps "Download / Save Image", THE Digital_ID_Service SHALL capture the ID card view as an image and save it to the device.
5. THE Digital_ID_Service SHALL display the cadet's full name, ID number, platoon, academic year, and active status on the ID card.
6. THE Digital_ID_Service SHALL be accessible without authentication for the public search portal.

---

### Requirement 8: Attendance Reports and Export

**User Story:** As an Admin, I want to generate and export attendance reports filtered by date range and platoon, so that I can submit official ROTC attendance records.

#### Acceptance Criteria

1. WHEN an Admin queries attendance reports, THE Reports_Service SHALL return only records that match all applied filters (date range, platoon, search query).
2. WHEN computing attendance scores, THE Reports_Service SHALL assign the following values: `present` = 1.0, `late` = 0.75, `absent` = 0.0, `excused` = 0.0.
3. WHEN exporting to Excel, THE Reports_Service SHALL produce a valid `.xlsx` file containing all queried attendance rows with columns: ID Number, Full Name, Platoon, Session Date, Session Type, Status, Score, Scan Time.
4. WHEN the exported Excel file is re-parsed, THE Reports_Service SHALL recover the same attendance data that was exported (round-trip integrity).
5. THE Reports_Service SHALL support filtering by `startDate`, `endDate`, `platoon`, and `searchQuery`.

---

### Requirement 9: Admin Cadet Management

**User Story:** As an Admin, I want to view, search, edit, and deactivate cadets, so that I can maintain an accurate and up-to-date cadet roster.

#### Acceptance Criteria

1. THE System SHALL display a searchable list of all cadets filterable by name, ID number, and platoon.
2. WHEN an Admin edits a cadet record, THE System SHALL update the cadet's `full_name`, `platoon`, `year_level`, `gender`, and `is_active` fields in the `users` table.
3. WHEN an Admin deactivates a cadet (`is_active = false`), THE System SHALL exclude that cadet from future `autoMarkAbsents` operations.
4. THE System SHALL display live statistics on the Admin home screen: total cadets, today's present count, and at-risk cadet count.

---

### Requirement 10: Announcements

**User Story:** As an Admin, I want to post announcements, so that all cadets are informed of important ROTC updates.

#### Acceptance Criteria

1. WHEN an Admin creates an announcement, THE System SHALL insert a record into the `announcements` table with `title`, `body`, `created_by`, and `created_at`.
2. WHEN a cadet views announcements, THE System SHALL display all announcements ordered by `created_at` descending.
3. THE System SHALL restrict announcement creation to users with `role = 'admin'`.

---

### Requirement 11: Security and Data Integrity

**User Story:** As a system administrator, I want all sensitive data to be protected and access to be role-restricted, so that cadet data is secure and the system cannot be abused.

#### Acceptance Criteria

1. THE System SHALL store all passwords exclusively as SHA-256 hashes and never persist plaintext passwords anywhere in the system.
2. THE System SHALL enforce Row Level Security (RLS) policies so that cadets can only read their own rows in the `attendance` and `users` tables.
3. THE System SHALL restrict `INSERT` and `UPDATE` on the `sessions` table to users with `role = 'admin'`.
4. THE System SHALL restrict `INSERT` on the `attendance` table to users with `role = 'admin'` or `role = 'officer'`.
5. THE System SHALL restrict `INSERT`, `UPDATE`, and `DELETE` on the `announcements` table to users with `role = 'admin'`.
6. THE Digital_ID_Service SHALL expose only non-sensitive fields (`full_name`, `id_number`, `platoon`, `year_level`, `qr_token`, `photo_url`, `is_active`) in the public search portal.

---

### Requirement 12: Performance and Offline Resilience

**User Story:** As a user in a low-connectivity environment, I want the app to remain functional and responsive, so that attendance operations are not disrupted by network issues.

#### Acceptance Criteria

1. THE System SHALL support QR scanning and offline queue operations without requiring network connectivity.
2. WHEN the device regains network connectivity, THE Offline_Sync_Service SHALL begin syncing the offline queue within 5 seconds of connectivity detection.
3. THE System SHALL debounce search input queries by at least 300ms before issuing Supabase requests.
4. THE System SHALL render cadet roster lists using virtualized list components (`FlatList`) to support 100+ cadet records without performance degradation.
5. THE System SHALL cache the authenticated `UserSession` in AsyncStorage to avoid redundant database queries on screen navigation.
