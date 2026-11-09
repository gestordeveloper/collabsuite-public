import { Router } from "express";
import * as uploadController from "../controllers/upload.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/", requireAuth, uploadController.uploadImage);
// Multipart upload for large binary files (meeting-recording audio, etc.) — see
// upload.controller.ts#uploadFile for why this exists alongside the base64/JSON route above.
router.post("/file", requireAuth, uploadController.uploadFileMiddleware, uploadController.uploadFile);
// Upload em partes para arquivos pesados (evita 502 do proxy): init → N chunks → complete.
router.post("/chunked/init", requireAuth, uploadController.initChunkedUpload);
router.post("/chunked/:uploadId/chunk/:index", requireAuth, uploadController.uploadChunkMiddleware, uploadController.uploadChunk);
router.post("/chunked/:uploadId/complete", requireAuth, uploadController.completeChunkedUpload);
// Public: used by the (unauthenticated) public proposal page and PDF export to fetch S3-hosted
// images through our own origin. Restricted server-side to our own bucket's host.
router.get("/proxy-image", uploadController.proxyImage);

export default router;
