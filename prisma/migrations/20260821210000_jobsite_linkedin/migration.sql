-- Add `linkedin` to the JobSite enums.
--
-- The scraper writes site='linkedin' rows; MySQL rejects an out-of-range ENUM
-- value outright, so every insert would fail until this lands. Appending at the
-- END of the list is deliberate: ENUM values are stored by ordinal index, so
-- inserting one in the middle would silently reassign every existing row's site.
--
-- Both tables are widened together even though only `jobs` is written today,
-- so a scraper pointed at jobs_temp for testing does not hit the same wall.

ALTER TABLE `jobs`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely',
    'himalayas','findmyremote','jobicy','themuse','linkedin'
  ) NOT NULL;

ALTER TABLE `jobs_temp`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','remoteok',
    'himalayas','findmyremote','jobicy','themuse','linkedin'
  ) NOT NULL;
