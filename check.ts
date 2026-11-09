import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany();
  console.log("USERS:", users.map(u => ({ id: u.id, email: u.email })));
  const funnels = await prisma.funnel.findMany();
  console.log("FUNNELS:", funnels.map(f => ({ id: f.id, name: f.name })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
