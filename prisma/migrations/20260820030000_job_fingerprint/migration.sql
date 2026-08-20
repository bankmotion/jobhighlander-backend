-- Content identity for a job, so a source that changes its listing id cannot
-- insert the same posting twice.
--
-- The column is added NULLABLE and WITHOUT its unique index here. Backfilling
-- and merging existing duplicates is done by src/scripts/dedupe-jobs.ts, which
-- has to re-point resumes and applied markers before any job row is removed;
-- adding the index now would fail against the duplicates already stored.
-- The index is added by the follow-up migration once that script has run.

ALTER TABLE `jobs` ADD COLUMN `fingerprint` CHAR(40) NULL;
ALTER TABLE `jobs_temp` ADD COLUMN `fingerprint` CHAR(40) NULL;
