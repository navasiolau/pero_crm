import { PrismaClient, Role, PayScheme } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "pero-demo-2026";

type SeedUser = {
  email: string;
  name: string;
  role: Role;
  payScheme: PayScheme;
  payPercent?: number;
};

const users: SeedUser[] = [
  {
    email: "admin@pero.local",
    name: "Администратор",
    role: Role.ADMIN,
    payScheme: PayScheme.PERCENT_TURNOVER,
    payPercent: 3,
  },
  {
    email: "director@pero.local",
    name: "Директор",
    role: Role.DIRECTOR,
    payScheme: PayScheme.NONE,
  },
  {
    email: "manager@pero.local",
    name: "Менеджер",
    role: Role.MANAGER,
    payScheme: PayScheme.NONE,
  },
  {
    email: "engineer@pero.local",
    name: "Инженер",
    role: Role.ENGINEER,
    payScheme: PayScheme.PERCENT_PROJECT,
    payPercent: 5,
  },
  {
    email: "worker@pero.local",
    name: "Работник",
    role: Role.WORKER,
    payScheme: PayScheme.PIECE,
  },
  {
    email: "mounter@pero.local",
    name: "Монтажник",
    role: Role.MOUNTER,
    payScheme: PayScheme.PIECE,
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        payScheme: user.payScheme,
        payPercent: user.payPercent ?? null,
        passwordHash,
        active: true,
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        payScheme: user.payScheme,
        payPercent: user.payPercent ?? null,
        passwordHash,
      },
    });
    console.log(`✔ ${user.email} (${user.role})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
