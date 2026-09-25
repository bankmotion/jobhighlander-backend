-- The location filter dropdown groups by this column on every job-list load.
-- Unindexed, that sorted 63k values into a temporary table each time.
CREATE INDEX `jobs_location_idx` ON `jobs` (`location`);
