import { Router } from "express";
import * as projectController from "../controllers/project.controller";
import * as funnelController from "../controllers/funnel.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createProjectSchema, updateProjectSchema, addProjectUserSchema, createFunnelSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, projectController.listProjects);
router.post("/", requireAuth, validate(createProjectSchema), projectController.createProject);
router.put("/:id", requireAuth, validate(updateProjectSchema), projectController.updateProject);
router.delete("/:id", requireAuth, projectController.deleteProject);

router.get("/:id/users", requireAuth, projectController.listProjectUsers);
router.post("/:id/users", requireAuth, validate(addProjectUserSchema), projectController.addUserToProject);
router.delete("/:id/users/:userId", requireAuth, projectController.removeUserFromProject);

router.get("/:id/funnels", requireAuth, funnelController.listFunnelsByProject);
router.post("/:id/funnels", requireAuth, validate(createFunnelSchema), funnelController.createFunnel);

export default router;
