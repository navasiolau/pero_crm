import { NextResponse } from "next/server";

// GET /api/v1/openapi.json — OpenAPI-описание публичного API (§14).
const document = {
  openapi: "3.1.0",
  info: {
    title: "PERO CRM API",
    version: "1.0.0",
    description:
      "Публичный REST API PERO CRM для плагинов и внешних интеграций. Авторизация: заголовок `Authorization: Bearer pero_…` — токены создаются в «Настройки → API и токены».",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Plugin: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          version: { type: "string" },
          apiVersion: { type: "integer" },
          enabled: { type: "boolean" },
          permissions: { type: "array", items: { type: "string" } },
        },
      },
      DomainEvent: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          payload: {},
          actor: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          processedAt: { type: ["string", "null"], format: "date-time" },
          attempts: { type: "integer" },
          lastError: { type: ["string", "null"] },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/": {
      get: {
        summary: "Информация о сервисе",
        responses: {
          "200": { description: "Имя сервиса, версия API, включённые модули" },
          "401": { description: "Нет или невалидный токен" },
        },
      },
    },
    "/plugins": {
      get: {
        summary: "Список модулей",
        parameters: [],
        responses: {
          "200": { description: "Модули и их статус" },
          "401": { description: "Нет или невалидный токен" },
          "403": { description: "Нужен scope read" },
        },
      },
    },
    "/plugins/{id}/commands/{command}": {
      post: {
        summary: "Запуск команды модуля",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "command",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Результат команды" },
          "404": { description: "Команда не найдена" },
          "409": { description: "Модуль выключен" },
        },
      },
    },
    "/events": {
      get: {
        summary: "Последние доменные события",
        responses: {
          "200": { description: "До 50 последних событий шины" },
          "403": { description: "Нужен scope read" },
        },
      },
    },
    "/events/dispatch": {
      post: {
        summary: "Повторная доставка необработанных событий (cron)",
        responses: {
          "200": { description: "Число обработанных событий" },
          "403": { description: "Нужен scope write" },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(document);
}
