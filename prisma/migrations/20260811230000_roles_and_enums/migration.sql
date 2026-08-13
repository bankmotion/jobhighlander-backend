-- Cast jobs.site to an enum
ALTER TABLE `jobs` MODIFY `site` ENUM('indeed') NOT NULL;

-- Add the user role enum (guest = pending until approved)
ALTER TABLE `users` ADD COLUMN `role` ENUM('super_admin', 'admin', 'bidder', 'guest') NOT NULL DEFAULT 'guest';
