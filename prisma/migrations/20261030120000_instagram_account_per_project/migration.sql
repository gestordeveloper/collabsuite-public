-- A conta do Instagram passa a pertencer a um projeto (cliente). As tabelas estavam vazias.
DELETE FROM `instagram_engagement`;
DELETE FROM `instagram_post`;
DELETE FROM `instagram_automation`;
DELETE FROM `instagram_account`;

-- instagram_account
ALTER TABLE `instagram_account` DROP FOREIGN KEY `instagram_account_user_id_fkey`;
DROP INDEX `instagram_account_user_id_key` ON `instagram_account`;
DROP INDEX `instagram_account_ig_user_id_idx` ON `instagram_account`;
ALTER TABLE `instagram_account` ADD COLUMN `project_id` INTEGER NOT NULL AFTER `id`, ADD COLUMN `connected` BOOLEAN NOT NULL DEFAULT true AFTER `user_id`;
CREATE UNIQUE INDEX `instagram_account_project_id_key` ON `instagram_account`(`project_id`);
CREATE UNIQUE INDEX `instagram_account_ig_user_id_key` ON `instagram_account`(`ig_user_id`);
CREATE INDEX `instagram_account_user_id_idx` ON `instagram_account`(`user_id`);
ALTER TABLE `instagram_account` ADD CONSTRAINT `instagram_account_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `instagram_account` ADD CONSTRAINT `instagram_account_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- instagram_post
ALTER TABLE `instagram_post` ADD COLUMN `account_id` INTEGER NOT NULL AFTER `id`;
CREATE INDEX `instagram_post_account_id_status_idx` ON `instagram_post`(`account_id`, `status`);
ALTER TABLE `instagram_post` ADD CONSTRAINT `instagram_post_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `instagram_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- instagram_automation
ALTER TABLE `instagram_automation` ADD COLUMN `account_id` INTEGER NOT NULL AFTER `id`;
CREATE INDEX `instagram_automation_account_id_status_idx` ON `instagram_automation`(`account_id`, `status`);
ALTER TABLE `instagram_automation` ADD CONSTRAINT `instagram_automation_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `instagram_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
