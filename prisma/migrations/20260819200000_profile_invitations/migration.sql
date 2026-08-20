-- Profile invitations: an owner lets another user USE one of their profiles.
-- Access begins only once the invitee accepts; `declined` is stored rather than
-- deleted so the owner can see the answer.

CREATE TABLE `profile_invitations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `user_id` INTEGER NOT NULL,
  `invited_by_id` INTEGER NOT NULL,
  `status` ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `responded_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `profile_invitations_profile_id_user_id_key` (`profile_id`, `user_id`),
  INDEX `profile_invitations_user_id_status_idx` (`user_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `profile_invitations` ADD CONSTRAINT `profile_invitations_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `profile_invitations` ADD CONSTRAINT `profile_invitations_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `profile_invitations` ADD CONSTRAINT `profile_invitations_invited_by_id_fkey`
  FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
