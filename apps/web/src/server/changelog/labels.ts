import { roleLabels } from "../../lib/roles";
import { stageLabels } from "../../lib/stages";
import { productStatusLabels } from "../../lib/product-statuses";
import { communicationTypeLabels, entrySchemeLabels, paySchemeLabels, payoutKindLabels, projectMaterialStatusLabels, stockMovementTypeLabels } from "../../lib/labels";

export const JOURNAL_ENTITY_LABELS: Record<string, string> = {
  project: "Проект", product: "Изделие", task: "Задача", work: "Работа", file: "Файл", client: "Клиент",
  commercialProposal: "КП", proposalContract: "Договор", proposalMedia: "Изображение КП", proposalArtifact: "Документ КП",
  payment: "Платёж", payout: "Выплата", payrollEntry: "Начисление", cashAccount: "Касса", financeDocument: "Финансовый документ",
  expenseArticle: "Статья расходов", counterparty: "Контрагент", priceItem: "Позиция прайс-листа", material: "Материал",
  materialCategory: "Категория материалов", materialUnit: "Единица измерения", projectMaterial: "Потребность в материале",
  stockMovement: "Движение материала", stockPurchase: "Закупка материала", logisticsTrip: "Рейс",
  logisticsDocument: "ТТН", logisticsPosting: "Оплата рейса", user: "Пользователь", apiToken: "Доступ API",
  telegramLink: "Привязка Telegram", plugin: "Модуль", orgSetting: "Настройка", notificationPreference: "Настройка уведомлений",
  taskAllocationGroup: "Распределение работы", timeEntry: "Учёт времени", taskTimeCutoff: "Завершение учёта времени",
  productPercentageCompletion: "Процентное начисление", productPercentageAdjustment: "Корректировка процента",
  productPercentageMember: "Участник работы", authentication: "Учётная запись", session: "Сеанс пользователя",
  kpArchiveImport: "Импорт архива КП", kpArchiveRecovery: "Восстановление архива КП", kpImportedProposalNormalization: "Импортированное КП",
  kpArchiveDocument: "Архивное КП", kpArchiveContract: "Архивный договор",
};

export const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  web: "CRM", telegram: "Telegram", api: "API", plugin: "Модуль", system: "Автоматизация", maintenance: "Обслуживание", cli: "Командная строка",
};

const actions: Record<string, string> = {
  create: "Создание", update: "Изменение", delete: "Удаление", softDelete: "Удаление", "soft-delete": "Удаление", "physical-purge": "Удаление файла из хранилища",
  status: "Изменение", stage: "Изменение", toggle: "Изменение", reassign: "Изменение", "inline.update": "Изменение",
  "kp.synchronize": "Изменение", "client.synchronize": "Изменение", "proposal.pricing.sync": "Изменение", "kp.cover": "Изменение",
  "number.change": "Изменение", "number.repair": "Изменение", "number.repair.rollback": "Изменение",
  "cover.change": "Изменение", "cover.upload": "Загрузка файла", "cover.delete": "Удаление файла", "kp.retire": "Удаление",
  "percentage.patch": "Изменение", "percentage.rateAdjust": "Изменение", "percentage-defaults.update": "Изменение",
  "kp.signature-defaults.update": "Изменение", "default-cash.update": "Изменение", "initialPrice.capture": "Изменение", "version.accept": "Изменение",
  "percentage.firstCompletion": "Начисление", "percentage.lateSettlement": "Начисление", "percentage.fxSettlement": "Начисление", accrue: "Начисление", "accrue-topup": "Доначисление",
  issue: "Выплата", request: "Запрос выплаты", revoke: "Отзыв доступа", revokeSessions: "Завершение сеансов",
  login: "Вход", logout: "Выход", "auth.login": "Вход", "auth.logout": "Выход", "session.login": "Вход", "session.logout": "Выход",
  signIn: "Вход", signOut: "Выход", link: "Привязка", unlink: "Отвязка", "telegram.link": "Привязка Telegram", "telegram.unlink": "Отвязка Telegram",
  "link.request": "Запрос привязки Telegram", enable: "Включение модуля", disable: "Выключение модуля", "command.ping": "Выполнение команды",
  "contract.draft.save": "Изменение", "contract.export.request": "Запрос выпуска договора", "contract.generated": "Выпуск договора",
  "contract.export.complete": "Выпуск договора", "pdf.request": "Запрос выпуска PDF", "pdf.publish": "Выпуск PDF",
  "pdf.generated": "Выпуск PDF", "version.restore": "Восстановление версии", restore: "Восстановление", command: "Выполнение команды",
  "timer.retire": "Завершение учёта времени", retire: "Завершение учёта времени", taskTransfer: "Перенос начисления", "piecework.v1": "Распределение работы",
  post: "Проведение", correct: "Изменение", reverse: "Сторнирование", cancel: "Отмена", upload: "Загрузка файла", generate: "Выпуск документа",
  "archive.reserve": "Подготовка импорта", "archive.publish": "Импорт данных", "archive.recovery.reserve": "Подготовка восстановления",
  "archive.recovery.publish": "Восстановление данных", "kp.import.normalize": "Изменение",
  noModel: "Изменение", "percentage.configure": "Изменение", "archive.document": "Импорт КП", "archive.settings": "Импорт настроек договора",
  "kp.api.media": "Подготовка изображения", "kp.api.command": "Запрос API", "kp.write.receipt": "Подтверждение сохранения КП",
  "cover.receipt": "Подтверждение изменения", "cover.delete.receipt": "Подтверждение удаления", "inline.receipt": "Подтверждение сохранения",
  "expense-issue.create": "Выдача материалов по чеку",
  "payment.project-assignment": "Назначение расхода на проект",
  "worker-allocation.receipt": "Подтверждение распределения",
};

const fields: Record<string, string> = {
  id: "Идентификатор", name: "Название", title: "Название", number: "Номер", numberInt: "Номер", suffixInt: "Номер в проекте",
  description: "Описание", comment: "Комментарий", notes: "Примечания", note: "Примечание", value: "Значение", state: "Состояние",
  status: "Статус", fromStatus: "Прежний статус", toStatus: "Новый статус", stage: "Этап", fromStage: "Прежний этап", toStage: "Новый этап",
  active: "Активен", enabled: "Включено", type: "Тип", kind: "Вид", section: "Раздел", action: "Действие", source: "Источник",
  project: "Проект", projectId: "Проект", projectIds: "Проекты", product: "Изделие", productId: "Изделие", productIds: "Изделия",
  products: "Изделия", productNumber: "Номер изделия", projectNumber: "Номер проекта", client: "Клиент", clientId: "Клиент",
  clientLabel: "Клиент", clientVersion: "Версия клиента", clientAddress: "Адрес клиента", customer: "Заказчик", counterpartyId: "Контрагент",
  contactPerson: "Контактное лицо", isContactPerson: "Контактное лицо",
  managerId: "Менеджер", managerLabel: "Менеджер", engineerId: "Инженер", engineerLabel: "Инженер", assigneeId: "Исполнитель",
  userId: "Пользователь", user: "Пользователь", actorId: "Автор", actorName: "Имя автора", actorType: "Тип автора", ownerId: "Владелец",
  createdById: "Создал", changedById: "Изменил", doneById: "Завершил", deletedById: "Удалил", uploadedById: "Загрузил",
  email: "Электронная почта", phone: "Телефон", address: "Адрес", lastName: "Фамилия", middleName: "Отчество", position: "Должность",
  telegram: "Telegram", username: "Имя Telegram", chatId: "Чат Telegram", roles: "Роли", role: "Роль", calendarEnabled: "Личный план включён",
  passwordChanged: "Пароль изменён", sessionVersion: "Версия сеансов", linkedAt: "Время привязки", permissions: "Разрешения", scopes: "Права API",
  password: "Пароль", passwordHash: "Пароль", accessToken: "Токен доступа", token: "Токен доступа", apiKey: "Ключ API", secret: "Секретный ключ", linkCode: "Код привязки",
  linkRequested: "Привязка запрошена", linkCodeExpiresAt: "Срок действия запроса привязки", botUsername: "Имя Telegram-бота", configured: "Настройка задана явно",
  company: "Компания", prefix: "Начало токена", revokedAt: "Время отзыва", pluginId: "Модуль", apiVersion: "Версия API модуля", version: "Версия",
  commandId: "Команда", commandName: "Команда",
  amount: "Сумма", total: "Итого", quantity: "Количество", qty: "Количество", quantityPerUnit: "Количество на изделие", unit: "Единица измерения",
  unitId: "Единица измерения", unitSnapshot: "Единица измерения", price: "Цена", initialPrice: "Первоначальная цена", expectedPrice: "Цена изделия",
  priceSnapshot: "Цена", lineTotalBYN: "Сумма изделий, BYN", bynAmount: "Сумма, BYN", projectAmount: "Сумма проекта", cashAmount: "Сумма выплаты",
  currency: "Валюта", cashCurrency: "Валюта выплаты", rate: "Курс", ratePercent: "Ставка, %", rateDate: "Дата курса", rateSource: "Источник курса",
  priceItemId: "Позиция прайс-листа", cashAccountId: "Касса", cashAccount: "Касса", expenseArticleId: "Статья расходов", direction: "Направление",
  payScheme: "Схема оплаты", payPercent: "Процент оплаты", scheme: "Вид начисления", paymentKind: "Вид оплаты", month: "Месяц",
  services: "Услуги", servicesTotal: "Стоимость услуг", delivery: "Доставка", unloading: "Разгрузка", installation: "Монтаж",
  proposalRoundingAdjustment: "Корректировка округления КП", productsSubtotalBYN: "Стоимость изделий, BYN", expectedTotalBYN: "Итого, BYN",
  materialId: "Материал", material: "Материал", categoryId: "Категория", sku: "Артикул", code: "Код", cost: "Стоимость",
  balance: "Остаток", warehouseBalance: "Остаток склада", purchase: "Закупка", unitPrice: "Цена за единицу", paidAt: "Время оплаты",
  reportDocumentIds: "Отчётные документы", issuedQty: "Выдано", purchasePrice: "Закупочная цена", minStock: "Минимальный остаток",
  recipientId: "Получатель", recipient: "Получатель", calculationVersion: "Версия расчёта", cashRate: "Курс кассы", payrollRate: "Курс выплаты",
  cashRateDate: "Дата курса кассы", payrollRateDate: "Дата курса выплаты", sourceMovementId: "Исходное движение", valueByn: "Стоимость, BYN", moneyByn: "Сумма, BYN",
  fileId: "Файл", fileIds: "Файлы", fileName: "Название файла", fileSize: "Размер файла", size: "Размер", mimeType: "Тип файла",
  sketchFileId: "Эскиз", coverFileId: "Обложка", previousFileId: "Прежний файл", replacedById: "Новый файл", files: "Файлы",
  workId: "Работа", taskId: "Задача", tasks: "Задачи", works: "Работы", dependencies: "Зависимости", dependsOnId: "Предыдущая задача",
  taskIds: "Задачи", dependencyIds: "Предшествующие задачи", dependentIds: "Зависимые задачи", entries: "Начисления",
  doneAt: "Выполнено", executorShare: "Доля исполнителя", stoppedAt: "Остановлено", autoStopped: "Остановлено автоматически", cutoffAt: "Время завершения", closed: "Завершённые записи",
  assignees: "Исполнители", members: "Участники", shares: "Доли", share: "Доля", shareUnits: "Доля", sharePercent: "Доля, %",
  poolWeightUnits: "Доля работы", stageShareUnits: "Доля этапа", allocationGroupId: "Группа распределения", budgetSource: "Источник оплаты",
  requiresPhoto: "Нужна фотография", estimateMinutes: "Плановое время, мин", durationMinutes: "Время, мин", duration: "Длительность",
  dueAt: "Срок", startAt: "Начало", startedAt: "Начало", finishedAt: "Завершение", date: "Дата", createdAt: "Создано", updatedAt: "Изменено",
  deletedAt: "Удалено", statusChangedAt: "Статус изменён", stageChangedAt: "Этап изменён", completedAt: "Завершено", issuedAt: "Выпущено",
  refusalReason: "Причина отказа", refusalComment: "Комментарий к отказу", reclamationReason: "Причина рекламации",
  reclamationDescription: "Описание рекламации", reclamationFault: "Виновная сторона", noModel: "Без модели", technicalSpecifications: "Технические характеристики",
  sections: "Разделы", rows: "Строки", label: "Название", text: "Текст", dimensions: "Размеры", width: "Ширина", height: "Высота", depth: "Глубина",
  materialName: "Материал", color: "Цвет", finish: "Покрытие", hardware: "Фурнитура", measurements: "Замеры", specification: "Характеристика",
  specifications: "Характеристики", items: "Позиции", itemIds: "Позиции", itemId: "Позиция", positionIndex: "Порядок", revision: "Ревизия",
  proposalId: "КП", proposalIds: "КП", proposal: "КП", contractId: "Договор", contract: "Договор", versionId: "Версия", sourceRefs: "Источники",
  acceptedVersionId: "Согласованная версия", acceptedAt: "Время согласования", retentionEpoch: "Поколение хранения", initialPriceCaptureEligible: "Первоначальная цена может быть зафиксирована",
  percentageRates: "Процентные ставки", order: "Порядок позиций", subject: "Предмет договора",
  clientSnapshot: "Реквизиты клиента", settings: "Настройки", settingsSnapshot: "Настройки договора", summary: "Итоги", signature: "Подпись",
  warranty: "Гарантия", warrantyText: "Гарантия", footer: "Примечание", footerText: "Примечание", exclusions: "Исключения", discounts: "Скидки",
  discount: "Скидка", tax: "Налог", taxRate: "Ставка налога", details: "Подробности", result: "Результат", reason: "Причина",
  tripId: "Рейс", trip: "Рейс", vehicle: "Автомобиль", vehicleId: "Автомобиль", driverId: "Водитель", driver: "Водитель", route: "Маршрут",
  lines: "Строки", lineIds: "Строки", documentId: "Документ", documentIds: "Документы", documents: "Документы", allocations: "Распределение",
  postingId: "Проведение", paymentId: "Платёж", stockMovementId: "Движение материала", operationId: "Операция", clientMutationId: "Запрос",
  manifest: "Состав рейса", percentBps: "Доля", nameSnapshot: "Название", numberSnapshot: "Номер", ttnNotRequired: "ТТН не требуется",
  refunds: "Возвраты", issuedQuantityChanges: "Изменение выданного количества",
  fingerprint: "Отпечаток запроса", requestFingerprint: "Отпечаток запроса", tokenId: "Доступ API", eventId: "Событие", jobId: "Задание",
  ok: "Успех", error: "Ошибка", errorCode: "Код ошибки", lastErrorCode: "Код ошибки", repeated: "Повтор запроса", noOp: "Без изменений",
};

export function journalEntityLabel(entity: string): string { return JOURNAL_ENTITY_LABELS[entity] ?? "Объект"; }
export function journalSourceLabel(source: string): string { return JOURNAL_SOURCE_LABELS[source] ?? "Другой источник"; }
export function journalActionLabel(action: string): string {
  return actions[action] ?? (/\.(?:update|save|synchronize|sync|change|patch|adjust)$/.test(action) ? "Изменение"
    : /\.(?:create|created)$/.test(action) ? "Создание" : /\.(?:delete|deleted|remove)$/.test(action) ? "Удаление"
      : /\.(?:generated|publish|published)$/.test(action) ? "Выпуск документа" : "Неизвестная операция");
}

export function journalFieldLabel(path: string): string {
  if (!path) return "Значение";
  return path.split(".").map(part => fields[part] ?? (/^\d+$/.test(part) ? `Позиция ${Number(part) + 1}`
    : /[а-яё]/i.test(part) ? part : `Дополнительное поле (${part})`)).join(" → ");
}

/** Перевод зависит от поля: название «DONE» не превращается в статус. */
export function journalEnumLabel(path: string, value: string, entity: string): string {
  const field = path.split(".").filter(part => !/^\d+$/.test(part)).at(-1) ?? "";
  let labels: Record<string, string> | undefined;
  if (/^(?:stage|fromStage|toStage|projectStage)$/.test(field)) labels = { ...stageLabels, PAUSED: "Приостановлен", RECLAMATION: "Рекламация" };
  else if (/^(?:status|fromStatus|toStatus|productStatus|statusAtCompletion)$/.test(field)) labels = entity === "task"
    ? { DRAFT: "Черновик", NEW: "Новая", IN_PROGRESS: "В работе", DONE: "Выполнена" }
    : { ...productStatusLabels, ...projectMaterialStatusLabels, RECLAMATION: "Рекламация" };
  else if (field === "roles" || field === "role") labels = roleLabels;
  else if (field === "scopes" || field === "permissions") labels = { read: "Чтение", write: "Изменение", admin: "Администрирование", "plugins:manage": "Управление модулями",
    "projects:read": "Просмотр проектов", "projects:write": "Изменение проектов", "tasks:write": "Изменение задач", "files:read": "Просмотр файлов",
    "kp:read": "Просмотр КП", "kp:write": "Изменение КП", "kp:media:write": "Загрузка изображений КП", "kp:generate": "Выпуск КП",
    "kp:contracts:read": "Просмотр договоров", "kp:contracts:write": "Изменение договоров", "kp:contracts:generate": "Выпуск договоров" };
  else if (field === "section") labels = { GENERAL: "Общие файлы", MEASUREMENT: "Замеры", PRODUCTION: "Файлы производства", INSTALLATION: "Файлы монтажа" };
  else if (field === "payScheme") labels = paySchemeLabels;
  else if (field === "scheme") labels = entrySchemeLabels;
  else if (field === "direction") labels = { INCOME: "Приход", EXPENSE: "Расход" };
  else if (field === "type") labels = { ...stockMovementTypeLabels, ...communicationTypeLabels, SUPPLIER: "Поставщик", CARRIER: "Перевозчик" };
  else if (field === "paymentKind" || field === "kind") labels = { ...payoutKindLabels, ENGINEERING: "Проектирование", ASSEMBLY: "Сборка", INSTALLATION: "Монтаж", ORDINARY: "Обычная работа", PIECE: "Сдельная оплата", PERCENTAGE: "Процентная оплата" };
  else if (field === "state") labels = { NEW: "Новый", DRAFT: "Черновик", PENDING: "Ожидает выполнения", PROCESSING: "Выполняется", READY: "Готово", SUCCEEDED: "Выполнено", FAILED: "Ошибка", CANCELLED: "Отменено", PENDING_FX: "Ожидает курса", SETTLED: "Начислено", SKIPPED_ONCE: "Начисление пропущено", LEGACY_PROTECTED: "Защищено историческим начислением", ACTIVE: "Активно", FROZEN: "Заблокировано", VERIFYING: "Проверяется", UNINITIALIZED: "Не настроено" };
  return labels?.[value] ?? value;
}
