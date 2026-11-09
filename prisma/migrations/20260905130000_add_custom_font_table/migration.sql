-- CreateTable
CREATE TABLE `custom_font` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `family` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `weight` INTEGER NOT NULL DEFAULT 400,
    `style` VARCHAR(10) NOT NULL DEFAULT 'normal',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `custom_font_user_id_idx`(`user_id`),
    INDEX `custom_font_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `custom_font` ADD CONSTRAINT `custom_font_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
