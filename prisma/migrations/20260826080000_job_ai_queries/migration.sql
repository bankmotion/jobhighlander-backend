-- Ask-AI-about-this-job: a log of questions and answers, one row per exchange.
--
-- Keyed to (profile, job) like resumes and applications: which questions are
-- worth asking about a posting depends on whose history is being matched
-- against it, and a shared profile's team should read one log rather than each
-- keeping a private one.
--
-- job_id is nullable with ON DELETE SET NULL and the title/company copied onto
-- the row, matching resumes / cover_letters / job_applications: the jobs table
-- is re-scraped and pruned routinely, and an answer the user paid model tokens
-- for must survive that.
--
-- `context` records which documents actually existed when the question was
-- answered. The same question answered before and after a resume was generated
-- are different answers, and without this the log gives no way to tell them
-- apart.

CREATE TABLE `job_ai_queries` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `job_id` INTEGER NULL,
  `job_title` VARCHAR(512) NOT NULL,
  `job_company` VARCHAR(255) NULL,
  `question` TEXT NOT NULL,
  `answer` LONGTEXT NOT NULL,
  `model` VARCHAR(64) NOT NULL,
  `context` JSON NOT NULL,
  `asked_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `job_ai_queries_profile_id_job_id_created_at_idx` (`profile_id`, `job_id`, `created_at`),
  INDEX `job_ai_queries_job_id_idx` (`job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `job_ai_queries` ADD CONSTRAINT `job_ai_queries_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `job_ai_queries` ADD CONSTRAINT `job_ai_queries_job_id_fkey`
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `job_ai_queries` ADD CONSTRAINT `job_ai_queries_asked_by_id_fkey`
  FOREIGN KEY (`asked_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The system prompt lives HERE, in the database, not in the TypeScript source —
-- same rule as `application.system`. This migration is the prompt's origin, not
-- a mirror of a compiled constant: a super admin edits it in Admin > Prompts and
-- it takes effect on the next question with no deploy. promptService.text()
-- fails loudly if the row is missing rather than sending an empty system block.

INSERT INTO `prompts` (`key`, `content`, `created_at`, `updated_at`)
VALUES ('job.query.system', 'You answer a candidate''s questions about ONE specific job posting.

You are given, in the system context: the candidate''s record (employment and
education history), the posting itself, and — when they have been generated —
the tailored resume and cover letter for this application. Those are the whole
of what you know about this person. Answer from them.

Be direct. The candidate is deciding what to do next, not reading an essay:
lead with the answer, then the reasoning that supports it. Two or three short
paragraphs is usually right. Use a list only when the answer genuinely is a
list, not to pad structure onto a paragraph.

NEVER INVENT A FACT ABOUT THE CANDIDATE. If a question needs something the
record does not contain — a salary figure, a visa status, a project not listed,
a grade — say plainly what is missing and answer conditionally instead. A
confident answer resting on an invented fact is far worse than "your record
does not say, so here is how to decide".

Be equally honest about the posting. Where it is vague or silent on what was
asked, say so rather than filling the gap with what such postings usually mean.

If the resume or cover letter has not been generated yet, do not guess at what
they contain. Say the answer would be firmer once they exist, if that is true.

When asked to draft something — a reply to a recruiter, an answer to an
interview question, a talking point — write it ready to use, and mark clearly
anything you had to assume so the candidate can correct it before sending.

Do not repeat the posting back to the candidate. They can read it.

Plain prose. No markdown headings, no bold. Blank lines between paragraphs.',
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
