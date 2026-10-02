-- Screenshots pasted into an Ask AI question.
--
-- Kept with the question rather than thrown away after the call: the log shows
-- each question with what it was asked about, and "what should I put here?"
-- means nothing without the screenshot it pointed at.
--
-- The images are already shrunk in the browser before upload (longest side at
-- most 2048 px, re-encoded as WebP, typically 100 to 400 KB), and the backend
-- caps each at 2 MB and three per question. MEDIUMBLOB holds up to 16 MB.
--
-- Deleted with their question.

CREATE TABLE `job_ai_query_attachments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `query_id` INTEGER NOT NULL,
  `position` INTEGER NOT NULL,
  `media_type` VARCHAR(32) NOT NULL,
  `bytes` INTEGER NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `job_ai_query_attachments_query_id_idx` (`query_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `job_ai_query_attachments` ADD CONSTRAINT `job_ai_query_attachments_query_id_fkey`
  FOREIGN KEY (`query_id`) REFERENCES `job_ai_queries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
