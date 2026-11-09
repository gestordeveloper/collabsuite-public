import { Router } from "express";
import * as c from "../controllers/github.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

// Pública: o GitHub redireciona o navegador para cá depois da autorização (sem Bearer).
router.get("/oauth/callback", c.oauthCallback);

router.use(requireAuth);

// Configuração do app (admin) e conta de cada pessoa
router.get("/config", c.getConfig);
router.put("/config", c.saveConfig);
router.get("/status", c.status);
router.post("/connect-url", c.connectUrl);
router.delete("/account", c.disconnect);

// Repositórios disponíveis para vincular
router.get("/repos", c.listRepos);
router.get("/orgs", c.listOrgs);

// Tudo de um projeto
const p = "/projects/:projectId";
router.get(`${p}/repo`, c.getLink);
router.post(`${p}/repo/create`, c.createRepo);
router.post(`${p}/repo/link`, c.linkRepo);
router.delete(`${p}/repo`, c.unlinkRepo);

router.post(`${p}/report`, c.generateReport);
router.get(`${p}/commits`, c.listCommits);
router.get(`${p}/commits/:ref`, c.getCommit);
router.get(`${p}/branches`, c.listBranches);
router.post(`${p}/branches`, c.createBranch);
router.delete(`${p}/branches`, c.deleteBranch);
router.get(`${p}/contents`, c.getContents);
router.put(`${p}/file`, c.putFile);
router.delete(`${p}/file`, c.deleteFile);

router.get(`${p}/pulls`, c.listPulls);
router.post(`${p}/pulls`, c.createPull);
router.get(`${p}/pulls/:n`, c.getPull);
router.get(`${p}/pulls/:n/files`, c.getPullFiles);
router.patch(`${p}/pulls/:n`, c.updatePull);
router.put(`${p}/pulls/:n/merge`, c.mergePull);
router.post(`${p}/pulls/:n/reviews`, c.reviewPull);
router.post(`${p}/issues/:n/comments`, c.addComment);

router.get(`${p}/issues`, c.listIssues);
router.post(`${p}/issues`, c.createIssue);
router.get(`${p}/issues/:n`, c.getIssue);
router.patch(`${p}/issues/:n`, c.updateIssue);

router.get(`${p}/actions/runs`, c.listRuns);
router.get(`${p}/actions/runs/:runId/jobs`, c.getRunJobs);
router.post(`${p}/actions/runs/:runId/rerun`, c.rerunRun);
router.post(`${p}/actions/runs/:runId/cancel`, c.cancelRun);
router.get(`${p}/actions/jobs/:jobId/logs`, c.getJobLogs);
router.get(`${p}/actions/workflows`, c.listWorkflows);
router.post(`${p}/actions/workflows/:workflowId/dispatch`, c.dispatchWorkflow);

export default router;
