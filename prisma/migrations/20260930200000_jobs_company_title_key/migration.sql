-- A key for "same company, same title", so a new job can be recognised as one
-- the board already has from any source.
--
-- The rule it serves (scraper/db.py and jobService.addManual): a NEW job is a
-- duplicate when a job with the same company and title was added in the last
-- 30 days. Existing rows are left exactly as they are; nothing is merged or
-- deleted. The key only decides what gets in from now on.
--
-- Normalised the way the job fingerprint is: lower-cased, every run of
-- characters other than a-z and 0-9 turned into one space, trimmed. So
-- "Microsoft" / "Senior  Software-Engineer" and "microsoft " / "Senior Software
-- Engineer" share a key. NULL when there is no company: a title alone would make
-- every "Software Engineer" at an unknown employer one job.
--
-- GENERATED and VIRTUAL, like easy_apply: every writer gets it without setting
-- it, adding it rewrites no rows, and the value is stored only in the index.
-- The lookups compute the same expression over their own inputs, so the
-- normalisation below exists in exactly one form: TRIM(REGEXP_REPLACE(LOWER(x),
-- '[^a-z0-9]+', ' ')). Change it here and in both lookups together.

ALTER TABLE `jobs`
  ADD COLUMN `company_title_key` CHAR(40) AS (
    CASE
      WHEN TRIM(REGEXP_REPLACE(LOWER(`company`), '[^a-z0-9]+', ' ')) = '' THEN NULL
      ELSE SHA1(CONCAT(
        TRIM(REGEXP_REPLACE(LOWER(`company`), '[^a-z0-9]+', ' ')), '|',
        TRIM(REGEXP_REPLACE(LOWER(`title`), '[^a-z0-9]+', ' '))
      ))
    END
  ) VIRTUAL;

-- The lookup reads by key and the last 30 days of `created_at`.
CREATE INDEX `jobs_company_title_key_created_at_idx`
    ON `jobs` (`company_title_key`, `created_at`);
