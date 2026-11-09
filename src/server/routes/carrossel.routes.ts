import { Router } from "express";
import * as c from "../controllers/carrossel.controller";
import * as comic from "../controllers/comic.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);

router.get("/ai/status", c.aiStatus);

router.get("/brandbooks", c.listBrandbooks);
router.post("/brandbooks/import-zip", c.uploadZipMiddleware, c.importBrandbook);
router.get("/brandbooks/:id", c.getBrandbook);
router.put("/brandbooks/:id", c.updateBrandbook);
router.delete("/brandbooks/:id", c.deleteBrandbook);
router.post("/brandbooks/:id/reanalyze", c.reanalyzeBrandbook);
router.get("/brandbooks/:id/templates/:code/preview", c.templatePreview);
router.get("/brandbooks/:id/assets/:filename", c.brandbookAsset);

router.get("/projects", c.listProjects);
router.post("/projects", c.createProject);
router.get("/projects/:id", c.getProject);
router.put("/projects/:id", c.saveProject);
router.delete("/projects/:id", c.deleteProject);
router.post("/projects/:id/duplicate", c.duplicateProject);
router.post("/projects/:id/export", c.exportProject);
router.post("/projects/:id/export-video-job", c.exportVideoJob);
router.get("/animation-presets", c.animationPresets);
router.get("/projects/:id/slides/:index/png", c.slidePng);
router.post("/upload-image", c.uploadImageMiddleware, c.uploadImage);

router.post("/preview-slide", c.previewSlide);

router.post("/generate-job", c.generateJob);
router.post("/regenerate-slide-job", c.regenerateSlideJob);
router.post("/review-job", c.reviewJob);
router.get("/jobs/:id", c.jobStatus);
router.post("/jobs/:id/cancel", c.jobCancel);

router.get("/prompts", c.listPrompts);
router.get("/image-text/style", c.getImageTextStyle);
router.put("/image-text/style/:scope", c.saveImageTextStyle);
router.post("/image-text/preview", c.previewImageText);

router.get("/people", c.listPeople);
router.post("/people", c.savePerson);
router.delete("/people/:id", c.deletePerson);
router.post("/people/:id/photos", c.uploadImageMiddleware, c.addPersonPhoto);
router.delete("/people/:id/photos", c.removePersonPhoto);

router.get("/image-providers", c.imageProviders);
router.get("/flow/status", c.flowStatus);
router.post("/flow/token", c.flowToken);
router.post("/flow/ping", c.flowPing);
router.get("/flow/next", c.flowNext);
router.post("/flow/jobs/:id/result", c.flowResult);
router.post("/flow/jobs/:id/error", c.flowError);
router.post("/generate-image", c.generateImage);
router.put("/prompts/:kind", c.savePrompt);

router.get("/comics/styles", comic.listStyles);
router.get("/comics/series", comic.listSeries);
router.post("/comics/series", comic.saveSeries);
router.delete("/comics/series/:id", comic.deleteSeries);
router.post("/comics/series/:id/characters/:charId/sheets", comic.uploadImageMiddleware, comic.uploadSheet);
router.delete("/comics/series/:id/characters/:charId/sheets", comic.deleteSheet);
router.get("/comics/series/:id/episodes", comic.listEpisodes);
router.post("/comics/episodes", comic.saveEpisode);
router.delete("/comics/series/:id/episodes/:episodeId", comic.deleteEpisode);
router.get("/comics/series/:id/episodes/:episodeId/share", comic.getShare);
router.post("/comics/series/:id/episodes/:episodeId/share", comic.setShare);
router.post("/comics/series/:id/episodes/:episodeId/:step-job", comic.startStep);
router.post("/comics/series/:id/season-job", comic.startSeason);
router.get("/comics/voices", comic.listVoices);
router.post("/comics/series/:id/episodes/:episodeId/audio", comic.uploadAudioMiddleware, comic.uploadAudio);
router.delete("/comics/series/:id/episodes/:episodeId/audio", comic.deleteAudio);
router.get("/eleven/settings", comic.getElevenSettings);
router.put("/eleven/settings", comic.saveElevenSettings);
router.get("/comics/series/:id/episodes/:episodeId/export.zip", comic.exportEpisode);
router.get("/comics/series/:id/export.zip", comic.exportSeries);

export default router;
