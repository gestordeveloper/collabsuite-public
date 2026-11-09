-- AlterTable
ALTER TABLE `habit` ADD COLUMN `health_metric` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `health_daily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `log_date` DATE NOT NULL,
    `steps` INTEGER NULL,
    `water_ml` INTEGER NULL,
    `sleep_min` INTEGER NULL,
    `sleep_quality` TINYINT NULL,
    `weight_kg` DOUBLE NULL,
    `body_fat` DOUBLE NULL,
    `waist_cm` DOUBLE NULL,
    `mood` TINYINT NULL,
    `energy` TINYINT NULL,
    `stress` TINYINT NULL,
    `notes` VARCHAR(500) NULL,
    `sources` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `health_daily_user_id_log_date_key`(`user_id`, `log_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_workout` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `log_date` DATE NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `duration_min` INTEGER NOT NULL,
    `calories` INTEGER NULL,
    `distance_km` DOUBLE NULL,
    `notes` VARCHAR(300) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `external_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `health_workout_user_id_log_date_idx`(`user_id`, `log_date`),
    UNIQUE INDEX `health_workout_user_id_source_external_id_key`(`user_id`, `source`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_profile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `goals` TEXT NULL,
    `sync_token_hash` VARCHAR(64) NULL,
    `sync_token_hint` VARCHAR(12) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `health_profile_user_id_key`(`user_id`),
    UNIQUE INDEX `health_profile_sync_token_hash_key`(`sync_token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `health_daily` ADD CONSTRAINT `health_daily_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_workout` ADD CONSTRAINT `health_workout_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_profile` ADD CONSTRAINT `health_profile_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
