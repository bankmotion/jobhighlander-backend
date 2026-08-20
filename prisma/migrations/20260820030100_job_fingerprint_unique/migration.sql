-- The duplicate guard itself. Split from the column migration because it can
-- only be created once src/scripts/dedupe-jobs.ts has merged the rows already
-- stored; run that first on any database that predates this.
--
-- Nullable column: MySQL treats NULLs as distinct in a UNIQUE index, so a row
-- whose fingerprint could not be computed still stores rather than colliding
-- with every other such row.

CREATE UNIQUE INDEX `jobs_site_fingerprint_key` ON `jobs`(`site`, `fingerprint`);
CREATE UNIQUE INDEX `jobs_temp_site_fingerprint_key` ON `jobs_temp`(`site`, `fingerprint`);
