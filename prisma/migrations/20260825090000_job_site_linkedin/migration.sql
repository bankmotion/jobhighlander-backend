-- Add `linkedin` to the site enums.
--
-- WRITTEN AFTER THE FACT. Both columns were already altered directly on this
-- database — jobs.site has been accepting 'linkedin' since 2026-08-21 and holds
-- 1,911 rows — but the change never reached schema.prisma or a migration. The
-- result was not cosmetic drift: Prisma refuses to decode an enum value it does
-- not know, so `jobs.findMany` threw "Value 'linkedin' not found in enum
-- 'JobSite'" and took the ENTIRE job list down with it, not just the LinkedIn
-- rows. The list page caught that as "could not reach the backend API", which
-- pointed at the wrong thing entirely.
--
-- Re-running the ALTER against a database that already has the value is a
-- no-op, so this is safe here and reproduces the state on a fresh database.
--
-- `linkedin` goes LAST in both, matching the live column order, so
-- `prisma migrate diff` reports zero drift.

ALTER TABLE `jobs` MODIFY `site` ENUM(
  'indeed', 'glassdoor', 'jobright', 'weworkremotely',
  'himalayas', 'findmyremote', 'jobicy', 'themuse', 'linkedin'
) NOT NULL;

-- jobs_temp keeps `remoteok` as well: it is staged there and is deliberately
-- not yet legal in `jobs`.
ALTER TABLE `jobs_temp` MODIFY `site` ENUM(
  'indeed', 'glassdoor', 'jobright', 'weworkremotely', 'remoteok',
  'himalayas', 'findmyremote', 'jobicy', 'themuse', 'linkedin'
) NOT NULL;
