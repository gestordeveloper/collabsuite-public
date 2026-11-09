-- Splits `funnel` (which used to play the role of "project") into `project`
-- (top level) + a new `funnel` (pipeline, child of project).
--
-- SAFE BY DESIGN: preserves every existing row. Each auto-created default pipeline
-- gets the SAME id as its parent project, so every pre-existing funnel_id value
-- already sitting in funnelstage/task/taskstagehistory keeps resolving correctly
-- without rewriting those tables at all.

-- a) Rename the table; InnoDB keeps existing FKs (from funnelstage, funneluser, task,
--    credential) pointing at the same physical table, now called `project`.
RENAME TABLE funnel TO project;

-- b) Create the new `funnel` (pipeline) table.
CREATE TABLE funnel (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NOT NULL,
  company_id INT DEFAULT NULL,
  name VARCHAR(200) DEFAULT NULL,
  prefix VARCHAR(10) DEFAULT NULL,
  is_default TINYINT(1) DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY funnel_project_id_idx (project_id),
  KEY funnel_company_id_idx (company_id),
  CONSTRAINT funnel_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- c) Core trick: one pipeline row per existing project, SAME id, so every pre-existing
--    funnel_id value already sitting in funnelstage/task/taskstagehistory resolves
--    correctly without touching those tables' data at all. Carries over `prefix` from
--    the old funnel row (still present on `project` at this point) so it isn't lost.
INSERT INTO funnel (id, project_id, company_id, name, prefix, is_default, created_at, updated_at)
SELECT id, id, company_id, 'Funil Principal', prefix, 1, created_at, updated_at FROM project;

-- d) Now that prefix has been copied to the new funnel table, remove it from project and
--    rename funnel_default -> is_default_project.
ALTER TABLE project DROP COLUMN prefix;
ALTER TABLE project CHANGE COLUMN funnel_default is_default_project TINYINT(1) DEFAULT 0;

-- e) Redirect funnelstage/task FKs from `project` onto the new `funnel` table.
ALTER TABLE funnelstage DROP FOREIGN KEY funnelstage_funnel_id_fkey;
ALTER TABLE funnelstage ADD CONSTRAINT funnelstage_funnel_id_fkey
  FOREIGN KEY (funnel_id) REFERENCES funnel(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE task DROP FOREIGN KEY task_funnel_id_fkey;
ALTER TABLE task ADD CONSTRAINT task_funnel_id_fkey
  FOREIGN KEY (funnel_id) REFERENCES funnel(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- f) Rename funneluser -> projectuser, funnel_id -> project_id.
--    The FK already targets `project` (inherited from the RENAME TABLE in step a); CHANGE COLUMN keeps it attached.
RENAME TABLE funneluser TO projectuser;
ALTER TABLE projectuser CHANGE COLUMN funnel_id project_id INT DEFAULT NULL;
ALTER TABLE projectuser RENAME INDEX funneluser_funnel_id_user_id_key TO projectuser_project_id_user_id_key;
ALTER TABLE projectuser RENAME INDEX funneluser_funnel_id_idx TO projectuser_project_id_idx;

-- g) credential.funnel_id -> project_id, same free-FK-rename logic.
ALTER TABLE credential CHANGE COLUMN funnel_id project_id INT DEFAULT NULL;
ALTER TABLE credential RENAME INDEX credential_funnel_id_idx TO credential_project_id_idx;

-- h) Cosmetic index/constraint renames so `prisma migrate diff` reports zero drift.
ALTER TABLE project RENAME INDEX funnel_company_id_idx TO project_company_id_idx;
ALTER TABLE project RENAME INDEX funnel_user_id_idx TO project_user_id_idx;
ALTER TABLE project RENAME INDEX funnel_drive_owner_user_id_idx TO project_drive_owner_user_id_idx;

ALTER TABLE project DROP FOREIGN KEY funnel_user_id_fkey;
ALTER TABLE project ADD CONSTRAINT project_user_id_fkey FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE project DROP FOREIGN KEY funnel_drive_owner_user_id_fkey;
ALTER TABLE project ADD CONSTRAINT project_drive_owner_user_id_fkey FOREIGN KEY (drive_owner_user_id) REFERENCES user(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE projectuser DROP FOREIGN KEY funneluser_funnel_id_fkey;
ALTER TABLE projectuser ADD CONSTRAINT projectuser_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE projectuser DROP FOREIGN KEY funneluser_user_id_fkey;
ALTER TABLE projectuser ADD CONSTRAINT projectuser_user_id_fkey FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE credential DROP FOREIGN KEY credential_funnel_id_fkey;
ALTER TABLE credential ADD CONSTRAINT credential_project_id_fkey FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE ON UPDATE CASCADE;
