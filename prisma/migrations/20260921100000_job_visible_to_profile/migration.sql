-- Who may see a hand-added posting.
--
-- NULL means everyone, which is what every scraped row is and what manual jobs
-- were before this column existed — so every existing row keeps exactly the
-- visibility it had, with no backfill.
--
-- Set to a profile id, the posting belongs to that profile alone. Someone
-- pasting a job they were sent privately had no way to say so: the only option
-- was the shared board.
--
-- Indexed because it joins the job list's WHERE on every query: the list asks
-- for "visible to everyone OR visible to me", and an unindexed OR over 52k rows
-- would undo the work the list indexes just did.
ALTER TABLE `jobs`
  ADD COLUMN `visible_to_profile_id` INT NULL AFTER `on_linkedin`,
  ADD INDEX `jobs_visible_to_profile_id_idx` (`visible_to_profile_id`);

ALTER TABLE `jobs`
  ADD CONSTRAINT `jobs_visible_to_profile_id_fkey`
    FOREIGN KEY (`visible_to_profile_id`) REFERENCES `profiles`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
