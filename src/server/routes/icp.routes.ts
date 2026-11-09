import { Router } from "express";
import * as icpController from "../controllers/icp.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createIcpSchema, updateIcpSchema } from "../validations/schemas";

const router = Router();

router.get("/", requireAuth, icpController.list);
router.post("/", requireAuth, validate(createIcpSchema), icpController.create);
router.get("/:id", requireAuth, icpController.get);
router.put("/:id", requireAuth, validate(updateIcpSchema), icpController.update);
router.delete("/:id", requireAuth, icpController.remove);

export default router;
