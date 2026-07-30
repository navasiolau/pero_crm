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
  {
    email: "accountant@pero.local",
    name: "Захарова Елена Владимировна",
    position: "Бухгалтер",
    phone: "+375 29 700-80-90",
    telegram: "@ezakharova",
    role: Role.ACCOUNTANT,
    // Схему оплаты владелец задаст в настройках; демо-экономику не трогаем
    payScheme: PayScheme.NONE,
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
  }
  // Демо-проекты вынесены в функцию, чтобы складской seed (ниже) работал
  // и на уже заполненной базе (ранний выход из main недопустим)
  const seedDemoProjects = async () => {
    if (clientsCount > 0) return;

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
  // Проект = заказ клиента с изделиями (цены — на изделиях).
  const projects = [
    {
      number: `П-${year}-001`,
      title: "Кухня и шкаф для Ивановой",
      stage: "IN_WORK" as const,
      clientId: ivanova.id,
      engineerId: engineer.id, // на него — % от стоимости (Σ изделий, §10)
      products: [
        {
          title: "Кухня «Модерн»",
          status: "PRODUCTION" as const,
          expectedPrice: 385000,
        },
        { title: "Шкаф-купе", status: "DESIGN" as const, expectedPrice: null },
      ],
    },
    {
      number: `П-${year}-002`,
      title: "Шкаф-купе для Петрова",
      stage: "CONTRACT" as const,
      clientId: petrov.id,
      engineerId: null,
      products: [
        { title: "Шкаф-купе", status: "DESIGN" as const, expectedPrice: 142000 },
      ],
    },
    {
      number: `П-${year}-003`,
      title: "Офисная мебель",
      stage: "LEAD" as const,
      clientId: alpha.id,
      engineerId: null,
      products: [
        { title: "Офисная мебель", status: "DESIGN" as const, expectedPrice: 96500 },
      ],
    },
    {
      number: `П-${year}-004`,
      title: "Прихожая «Лофт»",
      stage: "ESTIMATE" as const,
      clientId: ivanova.id,
      engineerId: null,
      products: [
        { title: "Прихожая «Лофт»", status: "DESIGN" as const, expectedPrice: null },
      ],
    },
  ];

  for (const project of projects) {
    const created = await prisma.project.create({
      data: {
        number: project.number,
        title: project.title,
        stage: project.stage,
        clientId: project.clientId,
        engineerId: project.engineerId,
        managerId: manager.id,
        createdById: manager.id,
        stageHistory: {
          create: { toStage: project.stage, changedById: manager.id },
        },
      },
    });
    let suffix = 0;
    for (const product of project.products) {
      suffix += 1;
      await prisma.product.create({
        data: {
          projectId: created.id,
          number: `${project.number}-${suffix}`,
          title: product.title,
          status: product.status,
          expectedPrice: product.expectedPrice,
          createdById: manager.id,
          statusHistory: {
            create: { toStatus: product.status, changedById: manager.id },
          },
        },
      });
    }
    console.log(`✔ проект ${created.number} (${created.stage}, изделий: ${suffix})`);
  }

  // Замер — типовая задача с обязательными фото (§6.2), на весь заказ
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
  // changeProjectStage, поэтому начисление инженеру (5% от стоимости =
  // Σ цен изделий = 385 000) вносим явно. Демо-выплат НЕТ: деньги платятся
  // только за прошлый месяц, а все начисления в seed — текущего (правило
  // владельца).
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
  // приходов. BYN, курс 1, основная касса; USD-приход 1000 по курсу
  // 2.8938 (эквивалент 2 893,8 BYN) — зафиксированная экономика П-001.
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
        projectId: kitchen.id,
        amount: 1000,
        currency: "USD",
        rate: 2.8938,
        rateDate: new Date(),
        bynAmount: 2893.8,
        projectAmount: 2893.8,
        cashAccountId: "seed-cash-usd",
        comment: "Предоплата в долларах",
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
  console.log("✔ демо-приходы (150 000 + 1 000 $ + 50 000)");

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
  };
  await seedDemoProjects();

  // ─── Демо-данные склада (§12, фаза 6) — идемпотентно ──────────────────
  // Категории/номенклатура — upsert по фиксированным id; движения и
  // потребность — только если журналы пусты (иначе количества задвоятся).
  const warehouseYear = new Date().getFullYear();
  for (const category of [
    { id: "seed-cat-ldsp", name: "ЛДСП и плиты" },
    { id: "seed-cat-kromka", name: "Кромка" },
    { id: "seed-cat-furnitura", name: "Фурнитура" },
    { id: "seed-cat-krepezh", name: "Крепёж" },
  ]) {
    await prisma.materialCategory.upsert({
      where: { id: category.id },
      update: { name: category.name },
      create: category,
    });
  }
  for (const material of [
    {
      id: "seed-mat-ldsp16",
      name: "ЛДСП 16 мм Белый (2750×1830)",
      sku: "LDSP-16-W",
      unit: "лист",
      categoryId: "seed-cat-ldsp",
      purchasePrice: 145,
      minStock: 5,
    },
    {
      id: "seed-mat-kromka2",
      name: "Кромка ПВХ 2 мм белая",
      sku: "KRM-2-W",
      unit: "м.п.",
      categoryId: "seed-cat-kromka",
      purchasePrice: 1.2,
      minStock: 200,
    },
    {
      id: "seed-mat-petlya",
      name: "Петля накладная с доводчиком",
      sku: "FRN-HINGE-SC",
      unit: "шт",
      categoryId: "seed-cat-furnitura",
      purchasePrice: 8.5,
      minStock: 20,
    },
    {
      id: "seed-mat-napr450",
      name: "Направляющие шариковые 450 мм",
      sku: "FRN-SLIDE-450",
      unit: "компл",
      categoryId: "seed-cat-furnitura",
      purchasePrice: 12,
      minStock: 10,
    },
    {
      id: "seed-mat-konfirmat",
      name: "Конфирмат 7×50",
      sku: "KRP-CONF-750",
      unit: "шт",
      categoryId: "seed-cat-krepezh",
      purchasePrice: 0.35,
      minStock: 500,
    },
  ]) {
    await prisma.material.upsert({
      where: { id: material.id },
      update: {
        name: material.name,
        sku: material.sku,
        unit: material.unit,
        categoryId: material.categoryId,
        purchasePrice: material.purchasePrice,
        minStock: material.minStock,
      },
      create: material,
    });
  }
  console.log("✔ категории и номенклатура склада (4 + 5)");

  if ((await prisma.stockMovement.count()) === 0) {
    await prisma.stockMovement.createMany({
      data: [
        {
          materialId: "seed-mat-ldsp16",
          type: "INCOME",
          quantity: 20,
          unitPrice: 145,
          totalByn: 2900,
          comment: "Закупка по накладной",
          createdById: manager.id,
        },
        {
          materialId: "seed-mat-kromka2",
          type: "INCOME",
          quantity: 500,
          unitPrice: 1.2,
          totalByn: 600,
          createdById: manager.id,
        },
        {
          materialId: "seed-mat-petlya",
          type: "INCOME",
          quantity: 100,
          unitPrice: 8.5,
          totalByn: 850,
          createdById: manager.id,
        },
        {
          materialId: "seed-mat-napr450",
          type: "INCOME",
          quantity: 20,
          unitPrice: 12,
          totalByn: 240,
          createdById: manager.id,
        },
      ],
    });
    console.log("✔ приходы на склад (4 позиции)");
  }

  // Демо-потребность и выдача — на изделии «Шкаф-купе» проекта П-****-002
  // (НЕ трогаем П-****-001: его экономика зафиксирована e2e-проверками).
  // ЛДСП: нужно 12, выдано 8 → «Можно запросить»; петли: 16 из 16 →
  // «Обеспечено»; кромка: нужно 600 при остатке 500 → «Нет на складе»
  // (красная строка + бейдж нехватки на проекте).
  const shkafProduct = await prisma.product.findUnique({
    where: { number: `П-${warehouseYear}-002-1` },
  });
  if (shkafProduct && (await prisma.projectMaterial.count()) === 0) {
    const [ldspLine, petlyaLine] = await Promise.all([
      prisma.projectMaterial.create({
        data: {
          productId: shkafProduct.id,
          materialId: "seed-mat-ldsp16",
          quantity: 12,
          issuedQty: 8,
          createdById: manager.id,
        },
      }),
      prisma.projectMaterial.create({
        data: {
          productId: shkafProduct.id,
          materialId: "seed-mat-petlya",
          quantity: 16,
          issuedQty: 16,
          createdById: manager.id,
        },
      }),
      prisma.projectMaterial.create({
        data: {
          productId: shkafProduct.id,
          materialId: "seed-mat-kromka2",
          quantity: 600,
          comment: "Кромление всех деталей",
          createdById: manager.id,
        },
      }),
    ]);
    await prisma.stockMovement.createMany({
      data: [
        {
          materialId: "seed-mat-ldsp16",
          type: "EXPENSE",
          quantity: 8,
          unitPrice: 145,
          totalByn: 1160,
          productId: shkafProduct.id,
          projectMaterialId: ldspLine.id,
          comment: "Заготовка корпуса",
          createdById: manager.id,
        },
        {
          materialId: "seed-mat-petlya",
          type: "EXPENSE",
          quantity: 16,
          unitPrice: 8.5,
          totalByn: 136,
          productId: shkafProduct.id,
          projectMaterialId: petlyaLine.id,
          createdById: manager.id,
        },
      ],
    });
    console.log("✔ потребность и выдача по П-002-1 (3 строки, 2 списания)");
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
