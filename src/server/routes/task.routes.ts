import { Router } from "express";
import * as taskController from "../controllers/task.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createTaskSchema, updateTaskSchema, addTaskMemberSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, taskController.listTasks);
router.get("/:id", requireAuth, taskController.getTask);
router.post("/", requireAuth, validate(createTaskSchema), taskController.createTask);
router.put("/:id", requireAuth, validate(updateTaskSchema), taskController.updateTask);
router.delete("/:id", requireAuth, taskController.deleteTask);
router.post("/:id/members", requireAuth, validate(addTaskMemberSchema), taskController.addTaskMember);
router.delete("/:id/members/:userId", requireAuth, taskController.removeTaskMember);
router.post("/:id/meet", requireAuth, taskController.generateMeetLink);
router.post("/:id/approval", requireAuth, taskController.setTaskApproval);
router.get("/:id/responses", requireAuth, taskController.getFormResponses);

export default router;