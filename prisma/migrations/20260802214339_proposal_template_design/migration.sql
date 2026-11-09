-- AlterTable
ALTER TABLE `proposal_template` ADD COLUMN `design` VARCHAR(20) NOT NULL DEFAULT 'classic',
    ADD COLUMN `slides` LONGTEXT NULL,
    ADD COLUMN `theme` LONGTEXT NULL;

