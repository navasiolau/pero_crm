const headerSelector = 'header[data-slot="page-header"]';
const backSelector = '[data-slot="page-back-link"]';

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export async function assertPageHeader(page, expectedHref) {
  const header = page.locator(headerSelector);
  const back = page.locator(backSelector);
  const visible = await header.first().waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false);
  check(visible, "HEADER_MISSING");
  check(await header.count() === 1, "HEADER_COUNT");
  check(await back.count() === (expectedHref === null ? 0 : 1), "ARROW_COUNT");
  if (expectedHref === null) return;

  check(await header.locator(backSelector).count() === 1, "ARROW_PLACEMENT");
  check(await back.isVisible(), "ARROW_VISIBLE");
  check(await back.getAttribute("href") === expectedHref, "ARROW_HREF");
  check(await back.evaluate(element => element.tagName === "A" && Boolean(element.getAttribute("aria-label")?.trim())
    && element.querySelectorAll("svg").length === 1), "ARROW_ACCESSIBILITY");
}
