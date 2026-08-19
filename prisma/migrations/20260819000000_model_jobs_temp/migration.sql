-- CreateTable
CREATE TABLE `jobs_temp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site` ENUM('indeed', 'glassdoor', 'jobright', 'weworkremotely', 'remoteok', 'himalayas', 'findmyremote', 'jobicy', 'themuse') NOT NULL,
    `site_job_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `job_url` VARCHAR(1024) NOT NULL,
    `apply_url` VARCHAR(2048) NULL,
    `company` VARCHAR(255) NULL,
    `company_url` VARCHAR(1024) NULL,
    `job_type` VARCHAR(64) NULL,
    `remote` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(255) NULL,
    `salary` VARCHAR(255) NULL,
    `posted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `jobs_site_idx`(`site`),
    UNIQUE INDEX `jobs_site_site_job_id_key`(`site`, `site_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

