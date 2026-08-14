-- Add `glassdoor` to the jobs.site enum (additive; existing rows unaffected)
ALTER TABLE `jobs` MODIFY `site` ENUM('indeed', 'glassdoor') NOT NULL;
