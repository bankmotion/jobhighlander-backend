-- Scraper admin: DB-managed settings + persisted session cookies.

CREATE TABLE `scraper_settings` (
  `key` VARCHAR(120) NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scraper_sessions` (
  `site` VARCHAR(64) NOT NULL,
  `cookies` LONGTEXT NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`site`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
