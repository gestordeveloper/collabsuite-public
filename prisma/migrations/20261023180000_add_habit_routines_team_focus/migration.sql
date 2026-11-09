-- CreateTable
CREATE TABLE `team_habit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `creator_id` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(255) NULL,
    `color` VARCHAR(20) NOT NULL DEFAULT '#EC1889',
    `target_per_week` INTEGER NOT NULL DEFAULT 7,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'habit',
    `project_id` INTEGER NULL,
    `reminder_time` VARCHAR(5) NULL,
    `reminder_days` VARCHAR(20) NULL,
    `checklist` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_habit_creator_id_idx`(`creator_id`),
    INDEX `team_habit_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_focus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `focus_date` DATE NOT NULL,
    `items` TEXT NOT NULL,
    `review` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `daily_focus_user_id_focus_date_key`(`user_id`, `focus_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `habit`
    ADD COLUMN `kind` VARCHAR(10) NOT NULL DEFAULT 'habit',
    ADD COLUMN `project_id` INTEGER NULL,
    ADD COLUMN `reminder_time` VARCHAR(5) NULL,
    ADD COLUMN `reminder_days` VARCHAR(20) NULL,
    ADD COLUMN `last_reminded_on` DATE NULL,
    ADD COLUMN `checklist` TEXT NULL,
    ADD COLUMN `team_habit_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `habit_project_id_idx` ON `habit`(`project_id`);

-- CreateIndex
CREATE INDEX `habit_team_habit_id_idx` ON `habit`(`team_habit_id`);

-- CreateIndex
CREATE INDEX `habit_reminder_time_idx` ON `habit`(`reminder_time`);

-- AddForeignKey
ALTER TABLE `team_habit` ADD CONSTRAINT `team_habit_creator_id_fkey` FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_habit` ADD CONSTRAINT `team_habit_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_focus` ADD CONSTRAINT `daily_focus_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `habit` ADD CONSTRAINT `habit_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `habit` ADD CONSTRAINT `habit_team_habit_id_fkey` FOREIGN KEY (`team_habit_id`) REFERENCES `team_habit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
