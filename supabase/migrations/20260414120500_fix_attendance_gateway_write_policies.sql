-- Fix attendance write RLS for custom-auth / anon client usage
-- The app writes to attendance using the anon key, so INSERT/UPDATE
-- policies must explicitly allow the anon role.

DROP POLICY IF EXISTS "attendance_insert_conditional" ON public.attendance;
CREATE POLICY "attendance_insert_conditional"
  ON public.attendance
  FOR INSERT
  TO anon
  WITH CHECK (
    public.check_access('anon')
    AND EXISTS (
      SELECT 1
      FROM public.sessions
      WHERE id = session_id
        AND (
          status = 'OPEN'
          OR status = 'CLOSED'
        )
    )
  );

DROP POLICY IF EXISTS "attendance_update_gateway" ON public.attendance;
CREATE POLICY "attendance_update_gateway"
  ON public.attendance
  FOR UPDATE
  TO anon
  USING (public.check_access('anon'))
  WITH CHECK (public.check_access('anon'));
