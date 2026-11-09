import { prisma } from "../lib/prisma";
import { hashPassword, comparePassword } from "../lib/bcrypt";
import { signToken, type JwtPayload } from "../lib/jwt";

const DEFAULT_PHOTO = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150";

export async function registerUser(data: {
  first_name: string;
  last_name?: string;
  email: string;
  username: string;
  password: string;
  biography?: string;
  photo?: string;
}) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: data.email }, { username: data.username }] },
  });

  if (existing) {
    throw { status: 400, message: "E-mail ou nome de usuário já cadastrado." };
  }

  const hashedPassword = await hashPassword(data.password);

  const newUser = await prisma.user.create({
    data: {
      first_name: data.first_name,
      last_name: data.last_name || "",
      email: data.email,
      username: data.username,
      password: hashedPassword,
      biography: data.biography || "",
      photo: data.photo || DEFAULT_PHOTO,
      status: "active",
    },
  });

  const token = signToken({ userId: newUser.id, email: newUser.email } satisfies JwtPayload);
  return { token, user: sanitizeUser(newUser) };
}

export async function loginUser(login: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: login }, { username: login }] },
  });

  if (!user) {
    throw { status: 401, message: "Credenciais inválidas." };
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    throw { status: 401, message: "Credenciais inválidas." };
  }

  const token = signToken({ userId: user.id, email: user.email } satisfies JwtPayload);
  return { token, user: sanitizeUser(user) };
}

export async function getUserById(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

export async function updateUser(id: number, data: { biography?: string; photo?: string; first_name?: string; last_name?: string; telephone?: string; username?: string; email?: string; password?: string; schedule_settings?: string }) {
  const updateData: any = { ...data };
  if (data.password) {
    updateData.password = await hashPassword(data.password);
  } else {
    delete updateData.password;
  }
  return prisma.user.update({ where: { id }, data: updateData });
}

export async function listUsers() {
  return prisma.user.findMany({
    where: {
      level: {
        gte: 8,
      },
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      username: true,
      photo: true,
      biography: true,
    },
  });
}

export function sanitizeUser(user: any) {
  const { password, ...safe } = user;
  return safe;
}