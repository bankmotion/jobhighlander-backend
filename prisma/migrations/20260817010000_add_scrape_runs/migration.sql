-- Scrape runs — one row per scraper run, logged by the Python scrapers.

CREATE TABLE `scrape_runs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `site` VARCHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'running',
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  `inserted` INTEGER NOT NULL DEFAULT 0,
  `updated` INTEGER NOT NULL DEFAULT 0,
  `unchanged` INTEGER NOT NULL DEFAULT 0,
  `skipped` INTEGER NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `scrape_runs_started_at_idx` (`started_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
