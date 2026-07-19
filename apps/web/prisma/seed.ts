import { PrismaClient, Role, PayScheme } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "pero-demo-2026";

type SeedUser = {
  email: string;
  name: string; // ФИО
  position: string;
  phone: string;
  telegram: string;
  role: Role;
  payScheme: PayScheme;
  payPercent?: number;
};

// Демо-сотрудники — конкретные люди, а не роли: действия и журнал
// привязываются к человеку (ФИО, должность, телефон, telegram).
const users: SeedUser[] = [
  {
    email: "admin@pero.local",
    name: "Ковалёв Дмитрий Сергеевич",
    position: "IT-администратор",
    phone: "+375 29 100-20-30",
    telegram: "@dkovalev",
    role: Role.ADMIN,
    payScheme: PayScheme.PERCENT_TURNOVER,
    payPercent: 3,
  },
  {
    email: "director@pero.local",
    name: "Петренко Андрей Викторович",
    position: "Директор",
    phone: "+375 29 200-30-40",
    telegram: "@apetrenko",
    role: Role.DIRECTOR,
    payScheme: PayScheme.NONE,
  },
  {
    email: "manager@pero.local",
    name: "Сидорова Ольга Николаевна",
    position: "Менеджер проектов",
    phone: "+375 29 300-40-50",
    telegram: "@osidorova",
    role: Role.MANAGER,
    payScheme: PayScheme.NONE,
  },
  {
    email: "engineer@pero.local",
    name: "Козлов Артём Игоревич",
    position: "Инженер-проектировщик",
    phone: "+375 29 400-50-60",
    telegram: "@akozlov",
    role: Role.ENGINEER,
    payScheme: PayScheme.PERCENT_PROJECT,
    payPercent: 5,
  },
  {
    email: "worker@pero.local",
    name: "Михайлов Сергей Петрович",
    position: "Столяр",
    phone: "+375 29 500-60-70",
    telegram: "@smikhailov",
    role: Role.WORKER,
    payScheme: PayScheme.PIECE,
  },
  {
    email: "mounter@pero.local",
    name: "Романюк Павел Андреевич",
    position: "Монтажник",
    phone: "+375 29 600-70-80",
    telegram: "@promanyuk",
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
        position: user.position,
        phone: user.phone,
        telegram: user.telegram,
        role: user.role,
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
        role: user.role,
        payScheme: user.payScheme,
        payPercent: user.payPercent ?? null,
        passwordHash,
      },
    });
    console.log(`✔ ${user.email} (${user.name})`);
  }

  // Демо-данные фазы 2: клиенты, проекты по этапам, замер (§6.2).
  // Идемпотентно: создаём, только если клиентов ещё нет.
  const clientsCount = await prisma.client.count();
  if (clientsCount > 0) {
    console.log("✔ демо-данные проектов уже есть — пропуск");
    return;
  }

  const manager = await prisma.user.findUniqueOrThrow({
    where: { email: "manager@pero.local" },
  });
  const worker = await prisma.user.findUniqueOrThrow({
    where: { email: "worker@pero.local" },
  });

  const ivanova = await prisma.client.create({
    data: {
      name: "Анна",
      lastName: "Иванова",
      middleName: "Петровна",
      phone: "+375 29 111-22-33",
      address: "Минск, пр. Победителей, 21-45",
    },
  });
  const petrov = await prisma.client.create({
    data: { name: "Сергей", lastName: "Петров", phone: "+375 29 222-33-44" },
  });
  const alpha = await prisma.client.create({
    data: {
      name: "ООО «Альфа»",
      phone: "+375 17 333-44-55",
      address: "Минск, ул. Тимирязева, 9",
    },
  });

  const year = new Date().getFullYear();
  const projects = [
    {
      number: `П-${year}-001`,
      title: "Кухня «Модерн»",
      stage: "IN_WORK" as const,
      expectedPrice: 385000,
      clientId: ivanova.id,
    },
    {
      number: `П-${year}-002`,
      title: "Шкаф-купе",
      stage: "CONTRACT" as const,
      expectedPrice: 142000,
      clientId: petrov.id,
    },
    {
      number: `П-${year}-003`,
      title: "Офисная мебель",
      stage: "LEAD" as const,
      expectedPrice: 96500,
      clientId: alpha.id,
    },
    {
      number: `П-${year}-004`,
      title: "Прихожая «Лофт»",
      stage: "ESTIMATE" as const,
      clientId: ivanova.id,
    },
  ];

  for (const project of projects) {
    const created = await prisma.project.create({
      data: {
        ...project,
        managerId: manager.id,
        createdById: manager.id,
        stageHistory: {
          create: { toStage: project.stage, changedById: manager.id },
        },
      },
    });
    console.log(`✔ проект ${created.number} (${created.stage})`);
  }

  // Замер — типовая задача с обязательными фото (§6.2)
  const kitchen = await prisma.project.findUniqueOrThrow({
    where: { number: `П-${year}-001` },
  });
  await prisma.task.create({
    data: {
      projectId: kitchen.id,
      title: "Замер на объекте",
      type: "Замер",
      assigneeId: worker.id,
      requiresPhoto: true,
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      createdById: manager.id,
    },
  });
  console.log("✔ задача «Замер» работнику");
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
