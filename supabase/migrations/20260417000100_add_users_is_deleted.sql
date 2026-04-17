-- ============================================================
-- ADD: Soft-delete flag for users (preserve history)
-- ============================================================
-- Purpose:
-- - Allow officers/admins to "delete" a cadet account while preserving
--   attendance history (FKs remain valid).
-- - The app will hide deleted cadets from the registry and disable login by
--   clearing credentials + QR token.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_is_deleted_idx
  ON public.users (is_deleted);

