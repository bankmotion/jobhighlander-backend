-- DropForeignKey
ALTER TABLE `resumes` DROP FOREIGN KEY `resumes_profile_id_fkey`;

-- DropIndex
DROP INDEX `resumes_profile_id_job_id_created_at_idx` ON `resumes`;

-- AlterTable
ALTER TABLE `resumes` MODIFY `data` JSON NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `resumes_profile_id_job_id_key` ON `resumes`(`profile_id`, `job_id`);

-- AddForeignKey
ALTER TABLE `resumes` ADD CONSTRAINT `resumes_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

