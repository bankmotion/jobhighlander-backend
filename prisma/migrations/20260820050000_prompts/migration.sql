-- Super-admin editable model instructions.
--
-- One row per generator. Every key has a compiled-in default, and a missing or
-- blank row falls back to it, so emptying this box restores shipped behaviour
-- rather than breaking generation.

CREATE TABLE `prompts` (
  `key` VARCHAR(64) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `updated_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `prompts` ADD CONSTRAINT `prompts_updated_by_id_fkey`
  FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
