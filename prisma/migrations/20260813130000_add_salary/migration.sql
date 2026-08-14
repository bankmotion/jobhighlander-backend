-- Add a nullable salary (range) column to jobs
ALTER TABLE `jobs` ADD COLUMN `salary` VARCHAR(255) NULL AFTER `location`;
