-- AlterTable
ALTER TABLE `funnel` ADD COLUMN `visibility` ENUM('everyone', 'restricted') NOT NULL DEFAULT 'everyone';

-- CreateTable
CREATE TABLE `funnel_user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `funnel_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `funnel_user_funnel_id_user_id_key`(`funnel_id`, `user_id`),
    INDEX `funnel_user_funnel_id_idx`(`funnel_id`),
    INDEX `funnel_user_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `funnel_user` ADD CONSTRAINT `funnel_user_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funnel_user` ADD CONSTRAINT `funnel_user_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
