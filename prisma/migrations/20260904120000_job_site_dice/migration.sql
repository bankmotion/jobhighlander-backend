-- Add `dice` to the site enums, for the new dice.com scraper
-- (job-seeking/scraper/dice.py).
--
-- Placed BEFORE `other` in both the enum and schema.prisma, so the column order
-- and the Prisma enum stay identical and `prisma migrate diff` reports zero
-- drift. `other` keeps its documented role as the trailing special case (jobs
-- added by hand, not a scraper target).
--
-- Reordering an ENUM is only a data concern when rows hold a value whose ordinal
-- moves; `other` has no rows (it exists for manually-added jobs and none have
-- been created), and MySQL converts by string value here regardless. Every
-- existing row keeps the value it had — MODIFY only widens the allowed set.
--
-- Prisma refuses to decode an enum value it does not know, and that failure is
-- not scoped to the offending rows: one unknown value makes `jobs.findMany`
-- throw and takes the whole job list down. So this has to land BEFORE the
-- scraper writes its first row.
ALTER TABLE `jobs`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','himalayas',
    'findmyremote','jobicy','themuse','linkedin','dice','other'
  ) NOT NULL;

-- jobs_temp keeps `remoteok` as well: it is staged there and is deliberately
-- not yet legal in `jobs`. It has no `other` member, so `dice` goes last.
ALTER TABLE `jobs_temp`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','remoteok','himalayas',
    'findmyremote','jobicy','themuse','linkedin','dice'
  ) NOT NULL;
