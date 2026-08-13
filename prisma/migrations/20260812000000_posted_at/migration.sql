-- Replace the relative-text `posted` with a calculated `posted_at` DATE
ALTER TABLE `jobs` DROP COLUMN `posted`;
ALTER TABLE `jobs` ADD COLUMN `posted_at` DATE NULL;
