import type { ZodType } from "zod";
import type { ToolDefinition } from "../types";
import { createTaskTool } from "./createTask.tool";
import { sendWhatsAppMessageTool } from "./sendWhatsAppMessage.tool";
import { getProjectSummaryTool } from "./getProjectSummary.tool";
import { generateImageTool } from "./generateImage.tool";
import { getIcpTool } from "./getIcp.tool";
import { createCarouselDesignTool } from "./createCarouselDesign.tool";
import { generateFileTool } from "./generateFile.tool";

export interface ToolHandlerContext {
  userId: number;
  companyId: number | null;
  agentId?: number;
  runId?: number;
}

export interface ToolHandler {
  definition: ToolDefinition;
  argsSchema: ZodType;
  execute(args: unknown, ctx: ToolHandlerContext): Promise<string>;
}

/** Named registry of tool handlers — an agent can only call what's listed here, never arbitrary code. */
export const TOOL_REGISTRY: Record<string, ToolHandler> = {
  create_task: createTaskTool,
  send_whatsapp_message: sendWhatsAppMessageTool,
  get_project_summary: getProjectSummaryTool,
  generate_image: generateImageTool,
  get_icp: getIcpTool,
  create_carousel_design: createCarouselDesignTool,
  generate_file: generateFileTool,
};

export function getToolDefinitions(names: string[]): ToolDefinition[] {
  return names.map((n) => TOOL_REGISTRY[n]?.definition).filter((d): d is ToolDefinition => !!d);
}

export async function executeTool(name: string, args: unknown, ctx: ToolHandlerContext): Promise<string> {
  const handler = TOOL_REGISTRY[name];
  if (!handler) {
    return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` });
  }
  try {
    return await handler.execute(args, ctx);
  } catch (err: any) {
    return JSON.stringify({ error: err?.message || "Erro ao executar ferramenta." });
  }
}
