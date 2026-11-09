import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { listFunnelsByUser } from "../src/server/services/funnel.service";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, first_name: true, last_name: true, email: true, level: true },
  });

  for (const u of users) {
    const funnels = await listFunnelsByUser(u.id);
    if (funnels.length > 0 || u.id === 1) {
      console.log(`User: ${u.first_name} ${u.last_name || ""} (ID: ${u.id}, Level: ${u.level}) -> Funnels Count: ${funnels.length}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
