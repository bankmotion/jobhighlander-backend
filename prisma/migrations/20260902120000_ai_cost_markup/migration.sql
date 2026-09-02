-- Cost markup: what this deployment charges over the vendor's list price.
--
-- Two additive changes and no data rewrite. Existing `ai_usage` rows get
-- `multiplier_bp = 10000` (list price), which is the truth about them: they
-- were priced at list when they ran. Raising them to the new markup is a
-- separate, deliberate step — `npm run backfill:ai-markup` — because it edits
-- money records and must be reviewed before it runs, not smuggled into a
-- schema migration that looks routine.

CREATE TABLE `ai_provider_rates` (
  `provider`         VARCHAR(16)  NOT NULL,
  -- Basis points of list price: 10000 = list, 12000 = 1.2x, 20000 = 2x.
  `multiplier_bp`    INT          NOT NULL DEFAULT 10000,
  `backfilled_at`    DATETIME(3)  NULL,
  `updated_by_email` VARCHAR(255) NULL,
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_usage`
  ADD COLUMN `multiplier_bp` INT NOT NULL DEFAULT 10000;
