-- Clarify field names + upgrade posted_at to a full timestamp
ALTER TABLE `jobs` CHANGE COLUMN `link` `job_url` VARCHAR(1024) NOT NULL;
ALTER TABLE `jobs` MODIFY COLUMN `posted_at` DATETIME(3) NULL;
