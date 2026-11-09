-- CreateTable
CREATE TABLE `github_app_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `client_id` VARCHAR(80) NOT NULL,
    `client_secret` TEXT NOT NULL,
    `public_url` VARCHAR(300) NULL,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `github_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `github_id` VARCHAR(20) NOT NULL,
    `login` VARCHAR(100) NOT NULL,
    `avatar` VARCHAR(300) NULL,
    `access_token` TEXT NOT NULL,
    `scope` VARCHAR(200) NULL,
    `token_error` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `github_account_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_repo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `owner` VARCHAR(100) NOT NULL,
    `repo` VARCHAR(100) NOT NULL,
    `default_branch` VARCHAR(100) NOT NULL DEFAULT 'main',
    `html_url` VARCHAR(300) NOT NULL,
    `is_private` BOOLEAN NOT NULL DEFAULT false,
    `linked_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_repo_project_id_key`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `github_account` ADD CONSTRAINT `github_account_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_repo` ADD CONSTRAINT `project_repo_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
