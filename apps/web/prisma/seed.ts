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
  const manager = await prisma.user.findUniqueOrThrow({
    where: { email: "manager@pero.local" },
  });
  const worker = await prisma.user.findUniqueOrThrow({
    where: { email: "worker@pero.local" },
  });
  const engineer = await prisma.user.findUniqueOrThrow({
    where: { email: "engineer@pero.local" },
  });

  // Демо-расценки (§9) — независимо от демо-проектов, идемпотентно
  const pricesCount = await prisma.priceItem.count();
  if (pricesCount === 0) {
    await prisma.priceItem.createMany({
      data: [
        { name: "Распил ЛДСП", unit: "м²", price: 12.5, category: "Заготовка" },
        { name: "Кромление", unit: "м.п.", price: 3.2, category: "Заготовка" },
        { name: "Присадка (сверловка)", unit: "шт", price: 1.8, category: "Заготовка" },
        { name: "Сборка корпуса", unit: "м²", price: 45, category: "Сборка" },
        { name: "Установка фасадов", unit: "шт", price: 15, category: "Сборка" },
        { name: "Замер", unit: "услуга", price: 50, category: "Выезд" },
        { name: "Монтаж кухни", unit: "м.п.", price: 120, category: "Монтаж" },
        { name: "Монтаж шкафа-купе", unit: "м²", price: 85, category: "Монтаж" },
      ],
    });
    console.log("✔ расценки (8 шт.)");
  }

  // Кассы (§11) — идемпотентно по фиксированным id. Основная касса BYN
  // совпадает с id из миграции фазы 5 (туда бэкфилнуты старые платежи).
  for (const account of [
    {
      id: "seed-cash-main",
      name: "Основная касса",
      currency: "BYN",
      comment: "Касса по умолчанию",
    },
    {
      id: "seed-cash-usd",
      name: "Валютный счёт",
      currency: "USD",
      comment: "Для платежей в долларах",
    },
  ]) {
    await prisma.cashAccount.upsert({
      where: { id: account.id },
      update: { name: account.name, currency: account.currency, comment: account.comment },
      create: account,
    });
  }
  console.log("✔ кассы (2 шт.)");

  // Статьи расходов (§8/§11) — идемпотентно по фиксированным id
  for (const article of [
    { id: "seed-article-materials", name: "Материалы", comment: "ЛДСП, фурнитура, кромка" },
    { id: "seed-article-logistics", name: "Логистика", comment: "Доставка, выезд" },
    { id: "seed-article-other", name: "Прочее", comment: null },
  ]) {
    await prisma.expenseArticle.upsert({
      where: { id: article.id },
      update: { name: article.name, comment: article.comment },
      create: article,
    });
  }
  console.log("✔ статьи расходов (3 шт.)");

  if (clientsCount > 0) {
    console.log("✔ демо-данные проектов уже есть — пропуск");
    return;
  }

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
      engineerId: engineer.id, // на него — % от стоимости (§10)
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
  const zamExists = await prisma.task.count({
    where: { projectId: kitchen.id, type: "Замер" },
  });
  if (zamExists === 0) {
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

  // Демо-данные фазы 4 (§10): проект создан сразу «В работе», минуя
  // changeProjectStage, поэтому начисление инженеру (5% от стоимости)
  // вносим явно. Демо-выплат НЕТ: деньги платятся только за прошлый
  // месяц, а все начисления в seed — текущего (правило владельца).
  const month = new Date().toISOString().slice(0, 7);
  await prisma.payrollEntry.create({
    data: {
      userId: engineer.id,
      projectId: kitchen.id,
      amount: 19250, // 385 000 × 5%
      scheme: "PERCENT_PROJECT",
      month,
      comment: `5% от стоимости · ${kitchen.number}`,
    },
  });
  console.log("✔ начисление инженеру (5% от стоимости)");

  // Демо-приходы (§10/§11): оборот месяца для «% от оборота» — сумма
  // приходов. BYN, курс 1, основная касса (эквиваленты = сумме).
  const shkaf = await prisma.project.findUniqueOrThrow({
    where: { number: `П-${year}-002` },
  });
  await prisma.payment.createMany({
    data: [
      {
        projectId: kitchen.id,
        amount: 150000,
        bynAmount: 150000,
        projectAmount: 150000,
        cashAccountId: "seed-cash-main",
        comment: "Аванс по договору",
        createdById: manager.id,
      },
      {
        projectId: shkaf.id,
        amount: 50000,
        bynAmount: 50000,
        projectAmount: 50000,
        cashAccountId: "seed-cash-main",
        comment: "Аванс по договору",
        createdById: manager.id,
      },
    ],
  });
  console.log("✔ демо-приходы (150 000 + 50 000)");

  // Демо-расход (§11): материалы на кухню — уменьшает маржу проекта
  await prisma.payment.create({
    data: {
      projectId: kitchen.id,
      direction: "EXPENSE",
      amount: 40000,
      bynAmount: 40000,
      projectAmount: 40000,
      cashAccountId: "seed-cash-main",
      expenseArticleId: "seed-article-materials",
      comment: "ЛДСП и фурнитура",
      createdById: manager.id,
    },
  });
  console.log("✔ демо-расход (материалы 40 000)");
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
