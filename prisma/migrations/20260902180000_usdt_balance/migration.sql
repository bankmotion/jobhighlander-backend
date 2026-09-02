-- Prepaid USDT balance, deposit claims, and the ledger that explains both.
--
-- Purely additive. Every existing user starts at a zero balance, which under
-- the new gate means AI is off until someone tops them up — see the note at
-- the bottom for the one command that changes that.

ALTER TABLE `users`
  ADD COLUMN `balance_micro_usd` INT NOT NULL DEFAULT 0;

CREATE TABLE `top_up_requests` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `user_id`            INT          NOT NULL,
  `chain`              ENUM('bep20','erc20') NOT NULL,
  `tx_hash`            VARCHAR(120) NOT NULL,
  `claimed_micro_usd`  INT          NOT NULL,
  `status`             ENUM('pending','credited','rejected') NOT NULL DEFAULT 'pending',
  `credited_micro_usd` INT          NULL,
  `note`               VARCHAR(500) NULL,
  `review_note`        VARCHAR(500) NULL,
  `reviewed_by_id`     INT          NULL,
  `reviewed_at`        DATETIME(3)  NULL,
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- The database is the only place that can reliably refuse a hash submitted
  -- twice: two admins reviewing at the same moment would both see "pending".
  UNIQUE KEY `top_up_requests_chain_tx_hash_key` (`chain`, `tx_hash`),
  KEY `top_up_requests_status_created_at_idx` (`status`, `created_at`),
  KEY `top_up_requests_user_id_idx` (`user_id`),

  CONSTRAINT `top_up_requests_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `top_up_requests_reviewed_by_id_fkey`
    FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `credit_entries` (
  `id`                      INT          NOT NULL AUTO_INCREMENT,
  `user_id`                 INT          NOT NULL,
  `kind`                    ENUM('topup','usage','adjustment') NOT NULL,
  -- Signed: positive credits, negative spends.
  `amount_micro_usd`        INT          NOT NULL,
  `balance_after_micro_usd` INT          NOT NULL,
  `note`                    VARCHAR(500) NULL,
  `ai_usage_id`             INT          NULL,
  `top_up_request_id`       INT          NULL,
  `created_by_id`           INT          NULL,
  `created_at`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `credit_entries_user_id_created_at_idx` (`user_id`, `created_at`),

  CONSTRAINT `credit_entries_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `credit_entries_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- NOT DONE HERE, deliberately: granting opening balances is a money decision,
-- not a schema one. Run `npm run grant:credit -- --email x@y.z --usd 25` per
-- user, or credit them from the admin review screen.
