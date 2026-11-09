import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/bcrypt";

export async function seedDatabase() {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) return;

    console.log("Database is empty. Seeding default data...");

    const defaultPassword = await hashPassword("password123");

    const defaultUser = await prisma.user.create({
      data: {
        first_name: "Ebenezer",
        last_name: "G.",
        email: "contato.gebenezer@gmail.com",
        username: "ebenezer",
        password: defaultPassword,
        status: "active",
        level: 10,
        role: "super_admin",
        photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
        biography: "Gestor de Projetos e Engenheiro de Software.",
      },
    });

    const memberUser1 = await prisma.user.create({
      data: {
        first_name: "Ana",
        last_name: "Silva",
        email: "ana@empresa.com",
        username: "ana_silva",
        password: defaultPassword,
        status: "active",
        level: 8,
        photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
        biography: "Designer de UI/UX apaixonada por criar interfaces intuitivas.",
      },
    });

    const memberUser2 = await prisma.user.create({
      data: {
        first_name: "Bruno",
        last_name: "Costa",
        email: "bruno@empresa.com",
        username: "bruno_costa",
        password: defaultPassword,
        status: "active",
        level: 8,
        photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
        biography: "Desenvolvedor Full-stack com foco em performance e bancos de dados.",
      },
    });

    const memberUser3 = await prisma.user.create({
      data: {
        first_name: "Carlos",
        last_name: "Silva",
        email: "carlos@empresa.com",
        username: "carlos_silva",
        password: defaultPassword,
        status: "active",
        level: 5,
        photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150",
        biography: "Analista de Suporte Júnior.",
      },
    });

    const project = await prisma.project.create({
      data: {
        name: "Desenvolvimento do App Móvel",
        content: "Projeto principal para o desenvolvimento do novo aplicativo móvel da empresa.",
        color: "#4f46e5",
        is_default_project: true,
        user_id: defaultUser.id,
      },
    });

    const salesFunnel = await prisma.funnel.create({
      data: {
        project_id: project.id,
        name: "Funil Principal",
        is_default: true,
      },
    });

    const stages = await Promise.all(
      [
        { name: "Backlog", status: "notdone", done: false },
        { name: "Em Progresso", status: "inprogress", done: false },
        { name: "Revisão / Testes", status: "inprogress", done: false },
        { name: "Concluído", status: "done", done: true },
      ].map((s, i) =>
        prisma.funnelStage.create({
          data: { funnel_id: salesFunnel.id, name: s.name, status: s.status, stage_order: i + 1, stage_done: s.done },
        })
      )
    );

    await prisma.projectUser.createMany({
      data: [
        { project_id: project.id, user_id: defaultUser.id },
        { project_id: project.id, user_id: memberUser1.id },
        { project_id: project.id, user_id: memberUser2.id },
      ],
    });

    await prisma.task.create({
      data: {
        funnel_id: salesFunnel.id,
        stage_id: stages[0].id,
        title: "Modelagem do Banco de Dados",
        description: "Definir as tabelas de usuários, tarefas e funis utilizando Prisma ORM.",
        priority: "high",
        status: "notdone",
        user_id: memberUser2.id,
        due_at: new Date(Date.now() + 86400000 * 3),
        estimated_time: "08:00",
        story_points: 5,
      },
    });

    await prisma.task.create({
      data: {
        funnel_id: salesFunnel.id,
        stage_id: stages[1].id,
        title: "Desenvolvimento da Interface Kanban",
        description: "Criar o visual interativo com suporte para drag and drop das colunas e cartões.",
        priority: "medium",
        status: "inprogress",
        user_id: memberUser1.id,
        due_at: new Date(Date.now() + 86400000),
        estimated_time: "12:00",
        story_points: 8,
        started_at: new Date(),
      },
    });

    const task3 = await prisma.task.create({
      data: {
        funnel_id: salesFunnel.id,
        stage_id: stages[2].id,
        title: "Reunião de Alinhamento Semanal",
        description: "Discussão das prioridades do sprint e impedimentos com toda a equipe.",
        priority: "high",
        status: "inprogress",
        type: "meeting",
        user_id: defaultUser.id,
        due_at: new Date(Date.now() + 86400000 * 2),
        hour_at: "10:00",
        end_at: new Date(Date.now() + 86400000 * 2),
        meet_id: "alignment-sync-01",
        meet_uri: "https://meet.google.com/abc-defg-hij",
        estimated_time: "01:00",
      },
    });

    await prisma.taskChecklist.createMany({
      data: [
        { task_id: task3.id, title: "Mapear relacionamentos de chaves estrangeiras", is_done: true },
        { task_id: task3.id, title: "Configurar migrations no MySQL", is_done: false },
        { task_id: task3.id, title: "Testar performance das queries com seed", is_done: false },
      ],
    });

    console.log("Seed completed successfully!");
  } catch (error) {
    console.error("[SEED ERROR] Database seeding failed. Have migrations been applied?", error);
  }
}