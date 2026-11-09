-- CreateTable
CREATE TABLE `generated_image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NULL,
    `run_id` INTEGER NULL,
    `prompt` TEXT NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `generated_image_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `generated_image_agent_id_idx`(`agent_id`),
    INDEX `generated_image_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `generated_image` ADD CONSTRAINT `generated_image_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_image` ADD CONSTRAINT `generated_image_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_image` ADD CONSTRAINT `generated_image_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
