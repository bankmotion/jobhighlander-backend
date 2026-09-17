-- Remote Rocketship: the site enum value, its LinkedIn flag, and per-profile
-- access to it.
--
-- Prisma refuses to decode an enum value it does not know, and that failure is
-- not scoped to the offending rows: one unknown value makes `jobs.findMany`
-- throw and takes the whole job list down. So this lands BEFORE the scraper
-- writes its first row. MODIFY only widens the allowed set.
ALTER TABLE `jobs`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','himalayas',
    'findmyremote','jobicy','themuse','linkedin','dice','ziprecruiter',
    'remoterocketship','other'
  ) NOT NULL;

ALTER TABLE `jobs_temp`
  MODIFY `site` ENUM(
    'indeed','glassdoor','jobright','weworkremotely','remoteok','himalayas',
    'findmyremote','jobicy','themuse','linkedin','dice','ziprecruiter',
    'remoterocketship'
  ) NOT NULL;

-- Whether the posting is ALSO on LinkedIn.
--
-- Nullable, and the three states are the point: TRUE and FALSE are answers,
-- NULL is "this source does not say". Only Remote Rocketship reports it, so
-- every existing row correctly stays NULL rather than being defaulted to a
-- made-up FALSE that the UI would then display as fact.
ALTER TABLE `jobs`
  ADD COLUMN `on_linkedin` BOOLEAN NULL AFTER `remote`;

ALTER TABLE `jobs_temp`
  ADD COLUMN `on_linkedin` BOOLEAN NULL AFTER `remote`;

-- What each profile is allowed to do.
--
-- Keyed on a registry string, not on a job site: the things needing a super
-- admin's approval are not all sources. Reading a paid site is one; seeing how
-- many other profiles applied to a posting is another. A `site` column could
-- only express the first, and every later feature would need its own migration.
--
-- Deny by default: no row means no permission. Nothing is granted here, so
-- every profile starts with none and a super admin opens them one at a time.
CREATE TABLE `profile_grants` (
  `id`            INT         NOT NULL AUTO_INCREMENT,
  `profile_id`    INT         NOT NULL,
  `feature`       VARCHAR(64) NOT NULL,
  `granted_by_id` INT         NOT NULL,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `profile_grants_profile_id_feature_key` (`profile_id`, `feature`),
  INDEX `profile_grants_feature_idx` (`feature`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `profile_grants`
  ADD CONSTRAINT `profile_grants_profile_id_fkey`
    FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `profile_grants_granted_by_id_fkey`
    FOREIGN KEY (`granted_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
