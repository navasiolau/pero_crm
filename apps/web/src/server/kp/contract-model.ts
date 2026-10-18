import { z } from "zod";
import { contractFailure, type ContractModelPort, type ContractModelProposal, type ContractObject, type ContractSettings } from "./contract-types";

const term = z.union([z.number().finite(), z.literal("")]);
const text = z.string().max(2000);
const customer = z.object({ type: text, name: text, signature: text, phone: text, email: text, registrationAddress: text,
  passport: text, taxId: text, registrationId: text, bankDetails: text, representative: text, position: text, authority: text }).strict();
const normalized = z.object({ number: text, date: text, city: text, contractorProfileId: text, subject: text, deliveryAddress: text,
  customer, proposalIds: z.array(z.string()).max(100), proposalOverrides: z.record(z.string(), z.json()), sameCustomerConfirmed: z.boolean(),
  productionDays: term, productionUnit: text, installationDays: term, installationUnit: text, warrantyMonths: term,
  payments: z.array(z.object({ mode: text, value: term, condition: text }).strict()).max(10) }).strict();

/** Порт вызывает исходную ContractModel из №184; своих расчётов платежей/сроков здесь нет. */
export function createContractModelPort(model: { normalizeSettings(value: unknown, state: unknown, id: string): unknown;
  validate(settings: unknown, proposals: unknown, profiles: unknown): unknown }): ContractModelPort {
  return {
    normalizeSettings(value, state, primaryId) {
      const result = normalized.safeParse(model.normalizeSettings(value, state, primaryId));
      if (!result.success) contractFailure("CONTRACT_SETTINGS_INVALID", "Проверьте поля настроек договора", 400);
      return result.data as ContractSettings;
    },
    validate(settings: ContractSettings, proposals: ContractModelProposal[], profiles: ContractObject[]) {
      const result = model.validate(settings, proposals, profiles);
      if (!result || typeof result !== "object" || !("errors" in result) || !Array.isArray(result.errors)) contractFailure("CONTRACT_MODEL_INVALID", "Не получен результат проверки договора", 500);
      const first = result.errors[0];
      if (first) contractFailure("CONTRACT_VALIDATION", typeof first === "object" && "message" in first && typeof first.message === "string" ? first.message : "Проверьте данные договора", 400);
      if (!("summary" in result)) contractFailure("CONTRACT_MODEL_INVALID", "Не получен расчёт договора", 500);
      const summary = z.record(z.string(), z.json()).safeParse(result.summary);
      if (!summary.success) contractFailure("CONTRACT_MODEL_INVALID", "Некорректный расчёт договора", 400);
      return summary.data as ContractObject;
    },
  };
}
