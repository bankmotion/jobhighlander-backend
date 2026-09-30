-- Easy Apply becomes a fact the database holds, so the job list can filter on it.
--
-- Until now the "Easy Apply" / "Apply Now" label was worked out in the browser
-- from the two links, which is fine for a label and useless for a filter: a
-- filter has to run in the query, or paging and totals describe a different set
-- from the one shown.
--
-- A GENERATED column, not one the writers fill in. Jobs are written by every
-- scraper (Python, through scraper/db.py), by the manual "add a job" form, and
-- rewritten by the Himalayas pass that swaps in the employer's link. Computing
-- it here keeps all of them right without touching any of them, and a row whose
-- apply link changes is re-labelled at once. VIRTUAL, so adding it rebuilds
-- nothing: the value is computed on read, and stored only in the index below.
--
-- The rule, which frontend/lib/apply-target.ts applies in the same way:
--   * Easy Apply when the apply link is on the same site as the posting (the
--     application happens on the job board, where the bidder is signed in), or
--     on LinkedIn or Indeed wherever the posting came from. The second half is
--     new: Jobright postings that send you to LinkedIn, and Glassdoor postings
--     that send you to Indeed, used to read "Apply Now".
--   * Apply Now otherwise, including when either link is missing or unusable.
-- "Same site" compares the last two labels of the host, as the browser does,
-- so smartapply.indeed.com and www.indeed.com are both indeed.com.
--
-- Checked before writing this: the expression and the browser's rule agree on
-- all 70,368 jobs in the table, with no exceptions.
--
-- Two indexes, mirroring the two the list already reads from with the new column
-- added after `remote`, so a filtered page is read in list order without touching
-- the table and its total is counted from the index alone. Remote-only is the
-- list's default, so the remote pair is the one most requests use.

ALTER TABLE `jobs`
  ADD COLUMN `easy_apply` BOOLEAN AS (
    CASE
      WHEN COALESCE(NULLIF(`apply_url`, ''), `job_url`) NOT LIKE '%://%' OR `job_url` NOT LIKE '%://%' THEN 0
      WHEN SUBSTRING_INDEX(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(COALESCE(NULLIF(`apply_url`, ''), `job_url`), '://', -1), '/', 1), '?', 1), '#', 1), '@', -1), ':', 1)), '.', -2) = SUBSTRING_INDEX(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(`job_url`, '://', -1), '/', 1), '?', 1), '#', 1), '@', -1), ':', 1)), '.', -2) THEN 1
      WHEN SUBSTRING_INDEX(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(COALESCE(NULLIF(`apply_url`, ''), `job_url`), '://', -1), '/', 1), '?', 1), '#', 1), '@', -1), ':', 1)), '.', -2) IN ('linkedin.com', 'indeed.com') THEN 1
      ELSE 0
    END
  ) VIRTUAL;

CREATE INDEX `jobs_easy_apply_created_at_id_visible_to_profile_id_idx`
    ON `jobs` (`easy_apply`, `created_at`, `id`, `visible_to_profile_id`);

CREATE INDEX `jobs_remote_easy_apply_created_at_id_visible_to_profile_id_idx`
    ON `jobs` (`remote`, `easy_apply`, `created_at`, `id`, `visible_to_profile_id`);
