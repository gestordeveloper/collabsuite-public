import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/lib/bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Updating database user levels...");

  // Update Ebenezer
  await prisma.user.updateMany({
    where: { username: "ebenezer" },
    data: { level: 10 },
  });

  // Update Ana
  await prisma.user.updateMany({
    where: { username: "ana_silva" },
    data: { level: 8 },
  });

  // Update Bruno
  await prisma.user.updateMany({
    where: { username: "bruno_costa" },
    data: { level: 8 },
  });

  // Create or update Carlos
  const defaultPassword = await hashPassword("password123");
  const carlos = await prisma.user.findUnique({
    where: { username: "carlos_silva" },
  });

  if (!carlos) {
    await prisma.user.create({
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
    console.log("Created Carlos Silva (level 5) successfully.");
  } else {
    await prisma.user.update({
      where: { username: "carlos_silva" },
      data: { level: 5 },
    });
    console.log("Updated Carlos Silva (level 5) successfully.");
  }

  console.log("User levels updated successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
