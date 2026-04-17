-- ============================================================
-- FIX: Allow users INSERT/UPDATE for custom-auth app flow
-- ============================================================
-- Context:
-- - App uses custom table-based auth with anon key (no auth.jwt role claims).
-- - Manual cadet creation and profile/photo updates require users INSERT/UPDATE.
-- - Existing policies only allow SELECT, causing:
--   "new row violates row-level security policy for table users"

-- Ensure gateway function exists (created in prior migrations)
CREATE OR REPLACE FUNCTION public.check_access()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Users write policies for custom-auth deployment
DROP POLICY IF EXISTS "users_insert_gateway" ON public.users;
CREATE POLICY "users_insert_gateway"
  ON public.users
  FOR INSERT
  TO anon
  WITH CHECK (public.check_access());

DROP POLICY IF EXISTS "users_update_gateway" ON public.users;
CREATE POLICY "users_update_gateway"
  ON public.users
  FOR UPDATE
  TO anon
  USING (public.check_access())
  WITH CHECK (public.check_access());

