-- CreateTable
CREATE TABLE `jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site` VARCHAR(64) NOT NULL,
    `site_job_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `link` VARCHAR(1024) NOT NULL,
    `location` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_site_idx`(`site`),
    UNIQUE INDEX `jobs_site_site_job_id_key`(`site`, `site_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
