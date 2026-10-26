-- Remove unused profile fields without rebuilding users or its foreign keys.
-- Existing email, password, display_name and all other retained data stay intact.
ALTER TABLE users DROP COLUMN username;
ALTER TABLE users DROP COLUMN description;
ALTER TABLE users DROP COLUMN birthday;
ALTER TABLE users DROP COLUMN phone;
ALTER TABLE users DROP COLUMN gender;
