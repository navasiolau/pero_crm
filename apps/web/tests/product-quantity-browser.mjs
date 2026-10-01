/** Native browser acceptance against the scoped QA project only. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export async function runQuantityBrowser({ prepared, origin, directory, captureRemote, target = "local", httpCredentials }) {
const captures = [];
async function capture() { const receipt = await captureRemote(); captures.push(receipt); return receipt; }
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(httpCredentials ? { httpCredentials } : {}) });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push({ message: String(error), url: page.url(), stack: error.stack }));
async function pick(scope, label, option) {
  const field = scope.locator("label").filter({ hasText: new RegExp("^" + escape(label)) }).first().locator("..");
  const combobox = field.getByRole("combobox");
  if (await combobox.count()) await combobox.click();
  else await field.getByRole("button").first().click();
  await page.getByRole("button", { name: new RegExp(escape(option)) }).last().click();
}
async function tab(name) { await page.getByRole("tab", { name: new RegExp("^" + name) }).click(); }
async function saveDialog(dialog, button) {
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
}
async function editCount(count, failure) {
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const dialog = page.locator('[data-slot="dialog-content"]').last();
  await dialog.locator("#product-quantity").fill(String(count));
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  if (failure) {
    await page.getByText(failure).last().waitFor({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  } else await dialog.waitFor({ state: "hidden", timeout: 15000 });
  await page.reload();
}
async function captureUntil(predicate) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const state = await capture();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("NATIVE_READBACK_TIMEOUT");
}
try {
  await page.goto(origin + "/login");
  await page.locator('input[type="email"]').fill(prepared.credentials.managerEmail);
  await page.locator('input[type="password"]').fill(prepared.credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 });
  await page.goto(origin + "/projects/" + prepared.ids.project);
  await tab("Изделия");
  let state = await capture();
  let batch = state.products.find((product) => product.id !== prepared.ids.control);
  if (!batch) {
    await page.getByRole("button", { name: "Изделие", exact: true }).click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await dialog.locator("#product-title").fill(`QA ${prepared.marker} Стул`);
    await dialog.locator("#product-price").fill("200");
    await dialog.locator("#product-quantity").fill("5");
    await pick(dialog, "Инженер", `QA ${prepared.marker} Менеджер-инженер`);
    await saveDialog(dialog, "Создать изделие");
    state = await capture(); batch = state.products.find((product) => product.id !== prepared.ids.control);
  }
  assert.ok(batch); assert.equal(batch.quantity, 5); assert.equal(batch.expectedPrice, "200");
  console.log("NATIVE_CREATE_AND_READBACK_PASS");
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.getByLabel("Количество: 5 шт.", { exact: true }).waitFor();
    await page.getByLabel("Количество: 5 шт.", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(directory, `${target}-project-board-${width}.png`), fullPage: true });
  }
  await page.goto(origin + "/products?q=" + encodeURIComponent(prepared.marker));
  await page.getByLabel("Количество: 5 шт.", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(directory, `${target}-products-board.png`), fullPage: true });
  await page.goto(origin + "/products/" + batch.number);
  await page.getByText("Количество: 5 шт.", { exact: true }).waitFor();
  await page.getByText(/Сумма партии:.*1\s*000.*BYN/).waitFor();
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.screenshot({ path: resolve(directory, `${target}-product-detail-${width}.png`), fullPage: true });
  }
  console.log("NATIVE_BOARDS_DETAIL_MOBILE_PASS");
  await tab("Работы и задачи");
  if (!state.works.length) {
    await page.getByRole("button", { name: "Работа", exact: true }).click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await pick(dialog, "Расценка из прайса", `QA ${prepared.marker} Сборка`);
    await dialog.locator("#work-qty").fill("1");
    await saveDialog(dialog, "Добавить");
  }
  state = await capture();
  assert.equal(state.works[0].quantityPerUnit, "1"); assert.equal(state.works[0].quantity, "5"); assert.equal(state.works[0].total, "150");
  await tab("Материалы");
  if (!state.materials.length) {
    await page.getByRole("button", { name: /Добавить материал/ }).first().click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await pick(dialog, "Материал", `QA ${prepared.marker} Петли`);
    await dialog.locator("#mat-add-qty").fill("4");
    await saveDialog(dialog, "Добавить");
  }
  state = await capture(); assert.equal(state.materials[0].quantityPerUnit, "4"); assert.equal(state.materials[0].quantity, "20");
  if (state.materials[0].issuedQty === "0") {
    await page.getByRole("button", { name: "Запросить со склада", exact: true }).first().click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await dialog.locator("#mat-line-qty").fill("8");
    await saveDialog(dialog, "Запросить");
  }
  state = await capture(); assert.ok(["6", "8"].includes(state.materials[0].issuedQty));
  console.log("NATIVE_WORK_AND_MATERIAL_BATCH_PASS");
  await editCount(1, /Материал.*Петли.*выдано|Работа.*распределено/);
  state = await capture(); assert.equal(state.products.find((product) => product.id === batch.id).quantity, 5);
  await editCount(6);
  state = await capture(); assert.equal(state.works[0].quantity, "6"); assert.equal(state.works[0].total, "180");
  assert.equal(state.materials[0].quantity, "24"); assert.ok(["6", "8"].includes(state.materials[0].issuedQty));
  await editCount(5);
  state = await capture(); assert.equal(state.works[0].quantity, "5"); assert.equal(state.materials[0].quantity, "20");
  console.log("NATIVE_QUANTITY_RECALCULATION_AND_REJECTION_PASS");
  // Процентный этап: единственная модель, цена одной штуки.
  await tab("Процентные этапы");
  const engineering = page.locator('[data-slot="card"]').filter({ has: page.locator("#ENGINEERING-rate") });
  if (!state.completions?.length) {
    await engineering.locator("#ENGINEERING-rate").fill("5");
    await engineering.getByRole("button", { name: "Сохранить настройки этапа", exact: true }).click();
    await page.getByText("Настройки этапа сохранены", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Сменить статус" }).click();
    await page.getByRole("option", { name: "В производстве", exact: true }).click();
  }
  state = await captureUntil((state) => state.completions?.some((row) => row.kind === "ENGINEERING" && row.state === "SETTLED"));
  const completion = state.completions.find((row) => row.kind === "ENGINEERING");
  assert.equal(completion.priceSnapshot, "200"); assert.equal(completion.sourceFundExact, "10");
  const percentageFrozen = JSON.stringify(state.completions);
  await editCount(6); state = await capture(); assert.equal(JSON.stringify(state.completions), percentageFrozen);
  await editCount(5); state = await capture(); assert.equal(JSON.stringify(state.completions), percentageFrozen);
  console.log("NATIVE_SINGLE_UNIT_PERCENT_AND_FROZEN_HISTORY_PASS");
  await tab("Работы и задачи");
  const taskTitle = `QA ${prepared.marker} Сборка партии`;
  if (!state.works[0].tasks.length) {
    await page.getByRole("button", { name: "Задача", exact: true }).click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await dialog.locator("#task-title").fill(taskTitle);
    const typeField = dialog.locator("label").filter({ hasText: /^Тип/ }).locator("..");
    await typeField.getByRole("combobox").click();
    await page.getByRole("option", { name: "Производство", exact: true }).click();
    await pick(dialog, "Исполнитель", `QA ${prepared.marker} Работник-монтажник`);
    await pick(dialog, "Работа (оплата)", `QA ${prepared.marker} Сборка`);
    await dialog.locator("#due").fill("2026-10-02");
    await dialog.locator("#est").fill("1");
    await dialog.locator("label").filter({ hasText: /^Количество из работы/ }).locator("..").locator("input").fill("4");
    await saveDialog(dialog, "Создать");
    state = await capture();
  }
  if (state.works[0].tasks.length === 1) {
    await page.getByText(taskTitle, { exact: true }).click();
    await page.getByRole("button", { name: "Разделить", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Разделить задачу", exact: true });
    await pick(dialog, "Кому передать часть задачи", `QA ${prepared.marker} Менеджер-инженер`);
    await dialog.getByLabel("Передать от текущей доли, %", { exact: true }).fill("30");
    await saveDialog(dialog, "Разделить задачу");
    await page.keyboard.press("Escape");
    await page.reload();
    state = await capture();
  }
  assert.equal(state.works[0].tasks.length, 2);
  assert.equal(state.works[0].tasks[0].allocationGroupId, state.works[0].tasks[1].allocationGroupId);
  assert.deepEqual(state.works[0].tasks.map((task) => task.shareAmount).sort(), ["36", "84"]);
  await editCount(3, /Работа.*распределено/);
  await editCount(4); state = await capture(); assert.equal(state.works[0].quantity, "4");
  await editCount(5);
  await tab("Работы и задачи");
  const workerCard = page.locator('[data-slot="card"]').filter({ hasText: taskTitle })
    .filter({ hasText: `QA ${prepared.marker} Работник-монтажник` }).first();
  state = await capture();
  const workerTask = state.works[0].tasks.find((task) => task.assigneeId === prepared.ids.worker);
  if (workerTask.status !== "DONE") {
    if (workerTask.status === "NEW") {
      await workerCard.getByRole("button", { name: "В работу", exact: true }).click();
      await captureUntil((state) => state.works[0].tasks.find((task) => task.id === workerTask.id)?.status === "IN_PROGRESS");
    }
    await page.reload(); await tab("Работы и задачи");
    await workerCard.getByRole("button", { name: "Выполнена", exact: true }).click();
    const timeDialog = page.getByRole("dialog", { name: "Фактическое время", exact: true });
    if (await timeDialog.isVisible()) {
      await timeDialog.locator("#actual-min").fill("1");
      await timeDialog.getByRole("button", { name: "Выполнено", exact: true }).click();
      await timeDialog.waitFor({ state: "hidden" });
    }
  }
  state = await captureUntil((state) => state.payroll.some((row) => row.taskId === workerTask.id));
  assert.equal(state.payroll.find((row) => row.taskId === workerTask.id).amount, "84");
  const payrollFrozen = JSON.stringify(state.payroll);
  await editCount(6); state = await capture(); assert.equal(JSON.stringify(state.payroll), payrollFrozen);
  await editCount(5); state = await capture(); assert.equal(JSON.stringify(state.payroll), payrollFrozen);
  console.log("NATIVE_SHARED_ALLOCATION_AND_PIECE_ACCRUAL_PRESERVED_PASS");
  await tab("Материалы");
  state = await capture();
  if (state.materials[0].issuedQty === "8") {
    await page.getByRole("button", { name: "Вернуть на склад", exact: true }).first().click();
    const dialog = page.locator('[data-slot="dialog-content"]').last();
    await dialog.locator("#mat-line-qty").fill("2");
    await saveDialog(dialog, "Вернуть");
  }
  state = await capture(); assert.equal(state.materials[0].issuedQty, "6");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/products?view=table&sort=quantity&dir=desc&q=" + encodeURIComponent(prepared.marker));
  await page.getByRole("columnheader", { name: /Количество/ }).waitFor();
  await page.getByRole("columnheader", { name: /Цена за 1 шт./ }).waitFor();
  await page.getByRole("columnheader", { name: /Сумма/ }).waitFor();
  await page.getByRole("columnheader", { name: /Сумма/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, `${target}-products-table.png`), fullPage: true });
  await page.goto(origin + "/projects/" + prepared.ids.project);
  await tab("Общее");
  await page.getByText(/1\s*100.*BYN/).first().waitFor();
  await page.screenshot({ path: resolve(directory, `${target}-project-sum.png`), fullPage: true });
  console.log("NATIVE_RETURN_TABLE_SORT_AND_PROJECT_SUM_PASS");
  assert.deepEqual(errors, [], "NATIVE_PAGE_ERRORS");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `native-${target}-receipt.json`), JSON.stringify({ status: `${target.toUpperCase()}_NATIVE_PASS`,
    origin, runId: prepared.runId, marker: prepared.marker, widths: [360, 390, 1440], captures, pageErrors: errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(directory, `${target}-native-failure.png`), fullPage: true }).catch(() => {});
  writeFileSync(resolve(directory, `${target}-native-failure.private.log`), String(error?.stack ?? error) + "\n" + await page.locator("body").innerText().catch(() => ""), { mode: 0o600 });
  console.error(`${target.toUpperCase()}_NATIVE_STOP`);
  throw new Error("QUANTITY_NATIVE_STOP");
} finally { await context.close(); await browser.close(); }

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const root = resolve(import.meta.dirname, "../../..");
 const directory = resolve(root, ".playwright-mcp/product-quantity");
 const prepared = JSON.parse(readFileSync(resolve(directory, "prepare-local.json"), "utf8"));
 await runQuantityBrowser({ prepared, directory, origin: "http://127.0.0.1:3116", captureRemote: () => {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "product-quantity-qa-runner.mjs"), "capture"],
   { cwd: resolve(root, "apps/web"), windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, "NATIVE_CAPTURE_PRESERVATION_STOP");
  return JSON.parse(readFileSync(resolve(directory, "capture-local.json"), "utf8"));
 } });
}
