-- CreateTable
CREATE TABLE `credential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `funnel_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `category` VARCHAR(30) NULL DEFAULT 'other',
    `username` VARCHAR(255) NULL,
    `password` TEXT NULL,
    `url` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `credential_funnel_id_idx`(`funnel_id`),
    INDEX `credential_user_id_idx`(`user_id`),
    INDEX `credential_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `credential` ADD CONSTRAINT `credential_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `credential` ADD CONSTRAINT `credential_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
