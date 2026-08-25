-- Education dates gain an explicit precision.
--
-- The column is a DATE, so a year-only entry is stored as YYYY-01-01 and is
-- byte-identical to a genuine January. Rendering therefore cannot infer what
-- the person meant, and this records it instead of guessing.
--
-- DEFAULT 'month' backfills every existing row: 8 of the 9 in this database
-- carry a non-January date, so they were entered with a real month and must
-- keep displaying one.

ALTER TABLE `educations`
  ADD COLUMN `date_precision` VARCHAR(8) NOT NULL DEFAULT 'month';
