import { PrismaClient, PayScheme, Role } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "pero-demo-2026";

// Seed — только учётные записи (решение владельца 09.2026: демо-проекты/
// финансы/склад удалены, реальная база — источник данных). Нужен для
// свежего dev-стенда: без пользователей в приложение не войти.
// Комбинированные роли (§4): пользователь с [MANAGER, ENGINEER] — для
// проверки фильтров «Менеджеры»/«Инженеры» и объединения прав.

type SeedUser = {
  email: string;
  name: string; // ФИО
  position: string;
  phone: string;
  telegram: string;
  roles: Role[];
  payScheme: PayScheme;
  payPercent?: number;
};

const users: SeedUser[] = [
  {
    email: "admin@pero.local",
    name: "Ковалёв Дмитрий Сергеевич",
    position: "IT-администратор",
    phone: "+375 29 100-20-30",
    telegram: "@dkovalev",
    roles: [Role.ADMIN],
    payScheme: PayScheme.PERCENT_TURNOVER,
    payPercent: 3,
  },
  {
    email: "director@pero.local",
    name: "Петренко Андрей Викторович",
    position: "Директор",
    phone: "+375 29 200-30-40",
    telegram: "@apetrenko",
    roles: [Role.DIRECTOR],
    payScheme: PayScheme.NONE,
  },
  {
    email: "manager@pero.local",
    name: "Сидорова Ольга Николаевна",
    position: "Менеджер проектов",
    phone: "+375 29 300-40-50",
    telegram: "@osidorova",
    roles: [Role.MANAGER],
    payScheme: PayScheme.NONE,
  },
  {
    email: "engineer@pero.local",
    name: "Козлов Артём Игоревич",
    position: "Инженер-проектировщик",
    phone: "+375 29 400-50-60",
    telegram: "@akozlov",
    roles: [Role.ENGINEER],
    payScheme: PayScheme.PERCENT_PROJECT,
    payPercent: 5,
  },
  {
    // Комбинация ролей (§4): виден и в фильтре «Менеджеры», и в «Инженеры»;
    // права = объединение, приоритет — за менеджером
    email: "manager-engineer@pero.local",
    name: "Гринько Марина Олеговна",
    position: "Менеджер-проектировщик",
    phone: "+375 29 350-45-55",
    telegram: "@mgrinko",
    roles: [Role.MANAGER, Role.ENGINEER],
    payScheme: PayScheme.NONE,
  },
  {
    email: "worker@pero.local",
    name: "Михайлов Сергей Петрович",
    position: "Столяр",
    phone: "+375 29 500-60-70",
    telegram: "@smikhailov",
    roles: [Role.WORKER],
    payScheme: PayScheme.PIECE,
  },
  {
    email: "mounter@pero.local",
    name: "Романюк Павел Андреевич",
    position: "Монтажник",
    phone: "+375 29 600-70-80",
    telegram: "@promanyuk",
    roles: [Role.MOUNTER],
    payScheme: PayScheme.PIECE,
  },
  {
    email: "accountant@pero.local",
    name: "Захарова Елена Владимировна",
    position: "Бухгалтер",
    phone: "+375 29 700-80-90",
    telegram: "@ezakharova",
    roles: [Role.ACCOUNTANT],
    payScheme: PayScheme.NONE,
  },
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        position: user.position,
        phone: user.phone,
        telegram: user.telegram,
        roles: user.roles,
        payScheme: user.payScheme,
        payPercent: user.payPercent ?? null,
        passwordHash,
        active: true,
      },
      create: {
        email: user.email,
        name: user.name,
        position: user.position,
        phone: user.phone,
        telegram: user.telegram,
        roles: user.roles,
        payScheme: user.payScheme,
        payPercent: user.payPercent ?? null,
        passwordHash,
      },
    });
    console.log(`✔ ${user.email} (${user.roles.join("+")})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
