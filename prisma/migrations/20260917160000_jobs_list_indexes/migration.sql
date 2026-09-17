-- Indexes for the job list. These were the entire cost of the page.
--
-- Measured before, on 52k rows: the list's ORDER BY took 1,436 ms with
-- `type=ALL key=NULL rows=46447 Using filesort` — a full scan and a sort of
-- every row to return twenty. Meanwhile `SELECT 1` was 1 ms and `COUNT(*)`
-- 9 ms, so neither the network nor the table size was ever the problem: there
-- was simply no index on the column the list sorts by.
--
-- Matches the ORDER BY exactly. MySQL reads a composite index backwards for a
-- matching DESC/DESC sort, turning scan-and-sort into a 20-row index read. `id`
-- is in the key because the list orders by it as a tiebreaker: rows scraped in
-- one batch share created_at to the millisecond, and without a total order the
-- same query can deal them into different pages.
CREATE INDEX `jobs_created_at_id_idx` ON `jobs` (`created_at`, `id`);

-- The default list is remote-only, so the common path filters then sorts. One
-- index serves both halves; without the leading column MySQL can use it for the
-- filter or the sort, not both.
CREATE INDEX `jobs_remote_created_at_id_idx` ON `jobs` (`remote`, `created_at`, `id`);

-- `site` belongs in the key, not just the filter.
--
-- Gated sources add `site IN (...)` to every query. With `site` absent from the
-- index above, EXPLAIN dropped `Using index` and kept `Using where`: it read
-- 19,395 actual rows purely to check one column, and the count behind the list
-- went from 6 ms to 651 ms. Including `site` restores the covering read — 7 ms.
CREATE INDEX `jobs_remote_site_created_at_id_idx` ON `jobs` (`remote`, `site`, `created_at`, `id`);

-- `posted_at` drives the "posted today / 24h / custom range" filter, and the
-- scrapers' resolve queues order by it. Same story: no index until now.
CREATE INDEX `jobs_posted_at_idx` ON `jobs` (`posted_at`);
