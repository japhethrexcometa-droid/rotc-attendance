-- Seed initial admin user
-- ID: admin
-- Password: password
-- SHA256 Hash of 'password': 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8

INSERT INTO public.users (id_number, full_name, role, password_hash, qr_token)
VALUES (
    'admin',
    'System Administrator',
    'admin',
    '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    'TOKEN-ADMIN-001'
) ON CONFLICT (id_number) DO NOTHING;

-- Seed a sample cadet
-- ID: 2024-0001
-- Password: password
INSERT INTO public.users (id_number, full_name, role, platoon, year_level, password_hash, qr_token)
VALUES (
    '2024-0001',
    'Jane Doe',
    'cadet',
    'Alpha',
    '1st Year',
    '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    'TOKEN-CADET-001'
) ON CONFLICT (id_number) DO NOTHING;
