-- Emphasis keywords (case-insensitive uniqueness via utf8mb4_unicode_ci)
CREATE TABLE `keywords` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `word` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `keywords_word_key`(`word`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
