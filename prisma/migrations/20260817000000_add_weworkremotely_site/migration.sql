-- Add `weworkremotely` to the jobs.site enum (additive; existing rows unaffected)
ALTER TABLE `jobs` MODIFY `site` ENUM('indeed', 'glassdoor', 'jobright', 'weworkremotely') NOT NULL;
