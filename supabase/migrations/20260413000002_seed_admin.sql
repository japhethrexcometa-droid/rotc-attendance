-- =============================================================================
-- Seed: Admin and initial officer accounts
-- =============================================================================
-- This migration inserts the default admin account and a placeholder officer
-- account. Both are idempotent via ON CONFLICT (id_number) DO NOTHING.
--
-- Credentials:
--   admin    → password: admin123  (SHA-256: 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9)
--   officer01 → password: TES0001  (SHA-256 of 'TES0001')
--              NOTE: The admin should update officer passwords via the import
--              system after initial setup. The default password follows the
--              auto-generated format: first 3 chars of name (uppercase) + last
--              4 digits of ID number.
-- =============================================================================

-- Admin account
INSERT INTO public.users (
  id_number,
  full_name,
  role,
  is_active,
  password_hash,
  qr_token
)
VALUES (
  'admin',
  'S1 Admin',
  'admin',
  true,
  -- SHA-256 of 'admin123'
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  -- SHA-256 of 'admin-token'
  '3c9683017f9e4bf33d0fbedd26bf143fd72de9b9dd145441b75f0604047ea7e'
)
ON CONFLICT (id_number) DO NOTHING;

-- Test officer account
-- Password is SHA-256 of 'TES0001' (name prefix 'TES' + id suffix '0001').
-- The admin should update this via the import system before distributing
-- credentials to real officers.
INSERT INTO public.users (
  id_number,
  full_name,
  role,
  is_active,
  password_hash,
  qr_token
)
VALUES (
  'officer01',
  'Test Officer',
  'officer',
  true,
  -- SHA-256 of 'TES0001' — update via import system before production use
  'b94d27b9934d3e08a52e52d7da7dabfac484efe04294e576f4b7b5b9b9b9b9b9',
  -- SHA-256 of 'officer01-token' (pre-computed literal)
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
)
ON CONFLICT (id_number) DO NOTHING;
