import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== USERS ===");
  const users = await prisma.user.findMany({
    select: { id: true, first_name: true, last_name: true, username: true, email: true, level: true },
  });
  console.log(JSON.stringify(users, null, 2));

  console.log("=== PROJECTS ===");
  const projects = await prisma.project.findMany({
    include: {
      projectUsers: {
        include: {
          user: { select: { first_name: true, level: true } }
        }
      },
      funnels: { select: { id: true, name: true } },
    }
  });

  for (const p of projects) {
    console.log(`Project ID: ${p.id}, Name: ${p.name}, Owner ID: ${p.user_id}`);
    console.log(`  Members:`, p.projectUsers.map(pu => `User ID: ${pu.user_id}, Name: ${pu.user?.first_name}, Level: ${pu.user?.level}`).join(", "));
    console.log(`  Funnels:`, p.funnels.map(f => `#${f.id} ${f.name}`).join(", "));
  }
}

main().finally(() => prisma.$disconnect());
