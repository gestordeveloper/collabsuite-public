-- Modify TaskStatus enum to add 'review'
ALTER TABLE `task` MODIFY COLUMN `status` ENUM('notdone','inprogress','done','review') NOT NULL DEFAULT 'notdone';
