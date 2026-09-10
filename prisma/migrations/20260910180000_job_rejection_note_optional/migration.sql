-- Make the rejection reason optional.
--
-- A NEW migration rather than an edit to 20260910170000, which has already run.
-- Prisma never re-applies an applied migration, so editing that file changed
-- nothing in the database while breaking its stored checksum — which makes
-- `prisma migrate deploy` refuse to run at all. The original is restored
-- verbatim and the correction lives here, where it can actually execute.
--
-- Loosening only: NOT NULL -> NULL cannot fail on existing rows, and every row
-- already has a reason because the old column demanded one.
ALTER TABLE `job_rejections`
  MODIFY COLUMN `note` TEXT NULL;
