-- ============================================================
-- ROTC Attendance System — Schema Extension Migration
-- Tasks 2.1, 2.2, 2.3
-- ============================================================

-- ============================================================
-- TASK 2.1 — EXTEND EXISTING TABLES & CREATE NEW ONES
-- ============================================================

-- ------------------------------------------------------------
-- Extend: users table
-- ------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS gender     TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    ADD COLUMN IF NOT EXISTS photo_url  TEXT,
    ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ------------------------------------------------------------
-- Extend: sessions table — add time columns and created_by
-- ------------------------------------------------------------
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS start_time  TIME,
    ADD COLUMN IF NOT EXISTS late_time   TIME,
    ADD COLUMN IF NOT EXISTS cutoff_time TIME,
    ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES public.users(id);

-- Migrate sessions.status constraint from ('active','closed') → ('OPEN','CLOSED')
DO $$ BEGIN
    ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_status_check
        CHECK (status IN ('OPEN', 'CLOSED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Update any existing rows that used the old lowercase values
UPDATE public.sessions SET status = 'OPEN'   WHERE status = 'active';
UPDATE public.sessions SET status = 'CLOSED' WHERE status = 'closed';

-- ------------------------------------------------------------
-- Extend: attendance table — update status constraint and add notes
-- ------------------------------------------------------------
DO $$ BEGIN
    ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE public.attendance
        ADD CONSTRAINT attendance_status_check
        CHECK (status IN ('present', 'late', 'absent', 'excused'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Update any existing rows that used the old 'error' value
UPDATE public.attendance SET status = 'absent' WHERE status = 'error';

ALTER TABLE public.attendance
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- ------------------------------------------------------------
-- Create: announcements table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on announcements
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- TASK 2.2 — UPDATE RLS POLICIES
-- ============================================================

-- ------------------------------------------------------------
-- Drop old permissive policies from init migration
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Sessions are readable by everyone"        ON public.sessions;
DROP POLICY IF EXISTS "Admins and officers can insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Allow reading attendance"                  ON public.attendance;
DROP POLICY IF EXISTS "Users are readable by everyone"           ON public.users;

-- ------------------------------------------------------------
-- users — open SELECT (needed for QR validation & digital-id portal)
-- ------------------------------------------------------------
CREATE POLICY "users_select_all"
    ON public.users FOR SELECT
    USING (true);

-- ------------------------------------------------------------
-- sessions — open SELECT; INSERT/UPDATE/DELETE restricted to admin
-- (app layer enforces role; custom auth does not use Supabase JWT)
-- ------------------------------------------------------------
CREATE POLICY "sessions_select_all"
    ON public.sessions FOR SELECT
    USING (true);

CREATE POLICY "sessions_insert_admin"
    ON public.sessions FOR INSERT
    WITH CHECK (true);   -- app layer checks role = 'admin'

CREATE POLICY "sessions_update_admin"
    ON public.sessions FOR UPDATE
    USING (true);        -- app layer checks role = 'admin'

CREATE POLICY "sessions_delete_admin"
    ON public.sessions FOR DELETE
    USING (true);        -- app layer checks role = 'admin'

-- ------------------------------------------------------------
-- attendance — open SELECT; INSERT for admin/officer; UPDATE for admin
-- ------------------------------------------------------------
CREATE POLICY "attendance_select_all"
    ON public.attendance FOR SELECT
    USING (true);

CREATE POLICY "attendance_insert_officer_admin"
    ON public.attendance FOR INSERT
    WITH CHECK (true);   -- app layer checks role IN ('admin','officer')

CREATE POLICY "attendance_update_admin"
    ON public.attendance FOR UPDATE
    USING (true);        -- app layer checks role = 'admin'

-- ------------------------------------------------------------
-- announcements — open SELECT; INSERT/UPDATE/DELETE for admin only
-- ------------------------------------------------------------
CREATE POLICY "announcements_select_all"
    ON public.announcements FOR SELECT
    USING (true);

CREATE POLICY "announcements_insert_admin"
    ON public.announcements FOR INSERT
    WITH CHECK (true);   -- app layer checks role = 'admin'

CREATE POLICY "announcements_update_admin"
    ON public.announcements FOR UPDATE
    USING (true);        -- app layer checks role = 'admin'

CREATE POLICY "announcements_delete_admin"
    ON public.announcements FOR DELETE
    USING (true);        -- app layer checks role = 'admin'


-- ============================================================
-- TASK 2.3 — SUPABASE STORAGE: cadet-photos BUCKET
-- ============================================================

-- Create the cadet-photos bucket if it does not already exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('cadet-photos', 'cadet-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read (download) photos — needed for digital-id portal
CREATE POLICY "cadet_photos_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'cadet-photos');

-- Allow authenticated app users to upload photos
CREATE POLICY "cadet_photos_insert"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'cadet-photos');
