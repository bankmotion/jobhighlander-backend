-- AlterTable
ALTER TABLE `profiles` ADD COLUMN `default_template_key` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `template_presets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `layout` VARCHAR(32) NOT NULL,
    `accent` VARCHAR(16) NOT NULL DEFAULT '#111111',
    `fontPair` VARCHAR(32) NOT NULL DEFAULT 'serif-classic',
    `density` VARCHAR(16) NOT NULL DEFAULT 'regular',
    `ats_safe` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `template_presets_key_key`(`key`),
    INDEX `template_presets_category_sort_order_idx`(`category`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
