// Сохраняемые pure target/table/canonical guards readonly/browser consumers; закрытый cash producer retired.
export const CASH_QA_TABLES = Object.freeze(["User", "Client", "Project", "Product", "ProductStatusHistory", "ProjectStageHistory",
  "Task", "TaskAllocationGroup", "TaskDependency", "PriceItem", "Work", "TimeEntry", "PayrollEntry", "ProductStagePayPool",
  "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare", "Payout", "CashAccount", "ExpenseArticle",
  "Payment", "OrgSetting", "MaterialCategory", "Material", "ProjectMaterial", "StockMovement", "File", "Communication",
  "Notification", "NotificationPreference", "UserPreference", "Plugin", "PluginSetting", "PluginRunLog", "DomainEvent",
  "ApiToken", "ChangeLog", "TelegramLink"]);
const LOCAL_ID = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const STAGE_ID = "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a";
export class CashQaStop extends Error {
  constructor(code) { super(code); this.name = "CashQaStop"; this.code = code; }
}
function check(ok, code) { if (!ok) throw new CashQaStop(code); }
export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { check(Number.isFinite(value), "INVALID_JSON_NUMBER"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  check(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "INVALID_JSON_OBJECT");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export function assertCashQaTarget(target) {
  check(target && typeof target === "object", "TARGET_MISSING");
  const local = target.kind === "EXISTING_LOCAL" && target.containerId === LOCAL_ID && target.host === "127.0.0.1" &&
    target.port === 5433 && target.database === "pero_crm";
  const stage = target.kind === "EXISTING_STAGING" && target.containerId === STAGE_ID && target.guest === "crm-staging" &&
    target.host === "db" && target.port === 5432 && target.database === "crm";
  check(local || stage, "TARGET_FORBIDDEN");
  return target;
}
