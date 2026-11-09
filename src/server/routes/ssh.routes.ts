import { Router } from "express";
import * as c from "../controllers/ssh.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

// Toda rota exige ser dono do projeto ou admin (checado no serviço, a cada chamada).
const p = "/projects/:projectId";
router.get(`${p}/access`, c.access);

router.get(`${p}/connections`, c.listConnections);
router.post(`${p}/connections`, c.createConnection);
router.put(`${p}/connections/:id`, c.updateConnection);
router.delete(`${p}/connections/:id`, c.deleteConnection);
router.post(`${p}/connections/:id/test`, c.testConnection);
router.post(`${p}/connections/:id/trust`, c.trustFingerprint);

router.get(`${p}/commands`, c.listCommands);
router.post(`${p}/commands`, c.createCommand);
router.put(`${p}/commands/:id`, c.updateCommand);
router.delete(`${p}/commands/:id`, c.deleteCommand);

router.get(`${p}/sessions`, c.listSessions);
router.get(`${p}/sessions/:id/recording`, c.recording);

export default router;
