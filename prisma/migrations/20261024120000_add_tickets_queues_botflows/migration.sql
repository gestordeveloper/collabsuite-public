-- AlterTable
ALTER TABLE `task` ADD COLUMN `ticket_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `whatsappconnection` ADD COLUMN `farewell_message` TEXT NULL,
    ADD COLUMN `greeting_message` TEXT NULL,
    ADD COLUMN `receive_tickets` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ticketqueue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `color` VARCHAR(20) NOT NULL,
    `greeting_message` TEXT NULL,
    `auto_distribution` BOOLEAN NOT NULL DEFAULT false,
    `last_distributed_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ticketqueue_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketqueueuser` (
    `queue_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,

    INDEX `ticketqueueuser_user_id_idx`(`user_id`),
    PRIMARY KEY (`queue_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chatcontact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `number` VARCHAR(40) NULL,
    `lid` VARCHAR(60) NULL,
    `profile_pic_url` TEXT NULL,
    `is_group` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `chatcontact_number_key`(`number`),
    UNIQUE INDEX `chatcontact_lid_key`(`lid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickettag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `color` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tickettag_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('pending', 'open', 'closed') NOT NULL DEFAULT 'pending',
    `contact_id` INTEGER NOT NULL,
    `connection_id` INTEGER NULL,
    `queue_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `unread_messages` INTEGER NOT NULL DEFAULT 0,
    `last_message` TEXT NULL,
    `last_message_at` DATETIME(3) NULL,
    `is_group` BOOLEAN NOT NULL DEFAULT false,
    `is_parallel` BOOLEAN NOT NULL DEFAULT false,
    `close_reason` VARCHAR(50) NULL,
    `customer_sentiment` VARCHAR(30) NULL,
    `closing_observations` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_status_updated_at_idx`(`status`, `updated_at`),
    INDEX `ticket_contact_id_idx`(`contact_id`),
    INDEX `ticket_connection_id_idx`(`connection_id`),
    INDEX `ticket_queue_id_idx`(`queue_id`),
    INDEX `ticket_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticketmessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wa_id` VARCHAR(120) NOT NULL,
    `connection_id` INTEGER NULL,
    `ticket_id` INTEGER NOT NULL,
    `contact_id` INTEGER NULL,
    `sender_user_id` INTEGER NULL,
    `from_me` BOOLEAN NOT NULL DEFAULT false,
    `body` TEXT NULL,
    `media_url` VARCHAR(500) NULL,
    `media_type` VARCHAR(30) NULL,
    `media_name` VARCHAR(255) NULL,
    `ack` INTEGER NOT NULL DEFAULT 0,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `is_internal` BOOLEAN NOT NULL DEFAULT false,
    `reactions` TEXT NULL,
    `quoted_wa_id` VARCHAR(120) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `ticketmessage_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    UNIQUE INDEX `ticketmessage_connection_id_wa_id_key`(`connection_id`, `wa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `botflow` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `queue_id` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `restart_on_reopen` BOOLEAN NOT NULL DEFAULT false,
    `draft_graph` LONGTEXT NULL,
    `published_graph` LONGTEXT NULL,
    `published_at` DATETIME(3) NULL,
    `status_filter` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `botflow_type_is_active_idx`(`type`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `botflowconnection` (
    `flow_id` INTEGER NOT NULL,
    `connection_id` INTEGER NOT NULL,

    PRIMARY KEY (`flow_id`, `connection_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `botflowsession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticket_id` INTEGER NOT NULL,
    `flow_id` INTEGER NOT NULL,
    `current_node_id` VARCHAR(100) NULL,
    `variables` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'running',
    `waiting_since` DATETIME(3) NULL,
    `resume_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `botflowsession_status_resume_at_idx`(`status`, `resume_at`),
    UNIQUE INDEX `botflowsession_ticket_id_flow_id_key`(`ticket_id`, `flow_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_TicketToTicketTag` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_TicketToTicketTag_AB_unique`(`A`, `B`),
    INDEX `_TicketToTicketTag_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `task_ticket_id_idx` ON `task`(`ticket_id`);

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketqueueuser` ADD CONSTRAINT `ticketqueueuser_queue_id_fkey` FOREIGN KEY (`queue_id`) REFERENCES `ticketqueue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketqueueuser` ADD CONSTRAINT `ticketqueueuser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `chatcontact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsappconnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_queue_id_fkey` FOREIGN KEY (`queue_id`) REFERENCES `ticketqueue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket` ADD CONSTRAINT `ticket_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketmessage` ADD CONSTRAINT `ticketmessage_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketmessage` ADD CONSTRAINT `ticketmessage_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `chatcontact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticketmessage` ADD CONSTRAINT `ticketmessage_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `botflow` ADD CONSTRAINT `botflow_queue_id_fkey` FOREIGN KEY (`queue_id`) REFERENCES `ticketqueue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `botflowconnection` ADD CONSTRAINT `botflowconnection_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `botflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `botflowconnection` ADD CONSTRAINT `botflowconnection_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsappconnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `botflowsession` ADD CONSTRAINT `botflowsession_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `botflowsession` ADD CONSTRAINT `botflowsession_flow_id_fkey` FOREIGN KEY (`flow_id`) REFERENCES `botflow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_TicketToTicketTag` ADD CONSTRAINT `_TicketToTicketTag_A_fkey` FOREIGN KEY (`A`) REFERENCES `ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_TicketToTicketTag` ADD CONSTRAINT `_TicketToTicketTag_B_fkey` FOREIGN KEY (`B`) REFERENCES `tickettag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
