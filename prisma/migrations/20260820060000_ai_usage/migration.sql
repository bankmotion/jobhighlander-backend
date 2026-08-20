-- Per-call Anthropic spend log.
--
-- Cost is priced once at call time and stored, rather than recomputed on read
-- from a live rate table: a spend log whose history changes when a price
-- changes cannot be reconciled against the invoice that was issued at the old
-- rate. Amounts are integer MILLIONTHS of a dollar — a thousand cached input
-- tokens on Opus cost $0.0005, which rounds away in cents.
--
-- user_id is SET NULL and job/profile carry no foreign key at all: jobs are
-- re-scraped and pruned routinely, and deleting a user or a posting must not
-- delete the money that was spent on it.

CREATE TABLE `ai_usage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `feature` VARCHAR(32) NOT NULL,
  `model` VARCHAR(64) NOT NULL,
  `user_id` INTEGER NULL,
  `user_email` VARCHAR(255) NULL,
  `profile_id` INTEGER NULL,
  `job_id` INTEGER NULL,
  -- Uncached remainder only; total prompt size is the sum of the three inputs.
  `input_tokens` INTEGER NOT NULL DEFAULT 0,
  `cache_write_tokens` INTEGER NOT NULL DEFAULT 0,
  `cache_read_tokens` INTEGER NOT NULL DEFAULT 0,
  `output_tokens` INTEGER NOT NULL DEFAULT 0,
  `cost_micro_usd` INTEGER NOT NULL DEFAULT 0,
  -- 0 when the model had no compiled-in rate, so the dashboard can report the
  -- gap instead of silently under-stating the bill.
  `priced` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_usage_created_at_idx`(`created_at`),
  INDEX `ai_usage_user_id_idx`(`user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_usage` ADD CONSTRAINT `ai_usage_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
