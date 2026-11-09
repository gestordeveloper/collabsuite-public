import type { Request, Response } from "express";
import * as projectService from "../services/project.service";
import { emitAll, emitToProject } from "../lib/socket";

export async function listProjects(req: Request, res: Response) {
  try {
    const projects = await projectService.listProjectsByUser(req.user!.id);
    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function createProject(req: Request, res: Response) {
  try {
    const project = await projectService.createProject(req.user!.id, req.body);
    emitAll("project_created", project);
    res.status(201).json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateProject(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    const project = await projectService.updateProject(projectId, req.user!.id, req.body);
    emitAll("project_updated", project);
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteProject(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    await projectService.deleteProject(projectId);
    emitAll("project_deleted", { projectId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function listProjectUsers(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    const users = await projectService.getProjectUsers(projectId);
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function addUserToProject(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    const { user_id } = req.body;
    const member = await projectService.addUserToProject(projectId, user_id);
    const projects = await projectService.listProjectsByUser(user_id);
    emitToProject(projectId, "project_user_added", { projectId, member });
    emitAll("projects_updated", projects);
    res.status(201).json(member);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function removeUserFromProject(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    await projectService.removeUserFromProject(projectId, userId);
    emitToProject(projectId, "project_user_removed", { projectId, userId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

