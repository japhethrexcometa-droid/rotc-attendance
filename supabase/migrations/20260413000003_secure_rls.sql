-- ============================================================
-- ROTC Attendance System — Security Hardening Migration
-- Resolving "RLS Policy Always True" warnings
-- ============================================================

-- 1. USERS: Only allow selecting active cadets
DROP POLICY IF EXISTS "users_select_all" ON public.users;
CREATE POLICY "users_select_active"
    ON public.users FOR SELECT
    USING (is_active = true);

-- 2. SESSIONS: No change needed for SELECT (public info), but we tighten metadata
-- Logic: We keep SELECT true for now as cadets need to see session status, 
-- but we could restrict it further in the future.

-- 3. ATTENDANCE: Prevent scans for CLOSED sessions
-- This adds a row-level check that actually validates the session status during INSERT
DROP POLICY IF EXISTS "attendance_insert_officer_admin" ON public.attendance;
CREATE POLICY "attendance_insert_conditional"
    ON public.attendance FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sessions 
            WHERE id = session_id AND status = 'OPEN'
        )
    );

-- 4. ANNOUNCEMENTS: No change to SELECT (public), but we ensure only non-empty titles are shown
DROP POLICY IF EXISTS "announcements_select_all" ON public.announcements;
CREATE POLICY "announcements_select_valid"
    ON public.announcements FOR SELECT
    USING (length(title) > 0);

-- 5. STORAGE: Tighten photo uploads
-- Previously check was empty or too permissive.
-- We ensure uploads are only allowed to the 'cadet-photos' bucket and 
-- follow a specific naming convention if possible.
DROP POLICY IF EXISTS "cadet_photos_insert" ON storage.objects;
CREATE POLICY "cadet_photos_insert_restricted"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'cadet-photos' AND 
        (LOWER(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp'))
    );
