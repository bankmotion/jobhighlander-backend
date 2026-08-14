-- Profiles (owned by an admin) + repeatable work experience & education.

CREATE TABLE `profiles` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `owner_id` INTEGER NOT NULL,
  `email` VARCHAR(255) NULL,
  `first_name` VARCHAR(120) NULL,
  `last_name` VARCHAR(120) NULL,
  `phone` VARCHAR(60) NULL,
  `linkedin` VARCHAR(512) NULL,
  `location` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `profiles_owner_id_idx` (`owner_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_experiences` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `company` VARCHAR(255) NULL,
  `location` VARCHAR(255) NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `work_experiences_profile_id_idx` (`profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `educations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `profile_id` INTEGER NOT NULL,
  `university` VARCHAR(255) NULL,
  `location` VARCHAR(255) NULL,
  `degree` VARCHAR(255) NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `educations_profile_id_idx` (`profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `profiles` ADD CONSTRAINT `profiles_owner_id_fkey`
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `work_experiences` ADD CONSTRAINT `work_experiences_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `educations` ADD CONSTRAINT `educations_profile_id_fkey`
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
