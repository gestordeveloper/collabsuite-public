-- CreateTable
CREATE TABLE `instagram_app_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `app_id` VARCHAR(40) NOT NULL,
    `app_secret` TEXT NOT NULL,
    `verify_token` VARCHAR(80) NOT NULL,
    `public_url` VARCHAR(300) NULL,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
