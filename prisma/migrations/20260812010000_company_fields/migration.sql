-- Add company / job-type / remote fields
ALTER TABLE `jobs`
  ADD COLUMN `company` VARCHAR(255) NULL,
  ADD COLUMN `company_url` VARCHAR(1024) NULL,
  ADD COLUMN `job_type` VARCHAR(64) NULL,
  ADD COLUMN `remote` BOOLEAN NOT NULL DEFAULT FALSE;
