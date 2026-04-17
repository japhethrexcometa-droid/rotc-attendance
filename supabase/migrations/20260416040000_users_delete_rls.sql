-- ============================================================
-- ADD: Allow DELETE on users table for admin officer removal
-- ============================================================
-- Context:
-- Admin needs to permanently delete officer accounts from the system.
-- This policy allows DELETE via the anon key (custom-auth deployment).

DROP POLICY IF EXISTS "users_delete_gateway" ON public.users;
CREATE POLICY "users_delete_gateway"
  ON public.users
  FOR DELETE
  TO anon
  USING (public.check_access());
