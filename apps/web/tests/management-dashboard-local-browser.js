/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright MCP consumes this file as a callback expression. */
async (page, state, selectedRoles) => {
  // Read-only browser acceptance with short-lived signed sessions, not password login.
  const base = "http://localhost:3102";
  const expected = { ADMIN: "/", DIRECTOR: "/", MANAGER: "/", ENGINEER: "/products", ACCOUNTANT: "/finance", WORKER: "/my", MOUNTER: "/my", "ENGINEER+MANAGER": "/" };
  const results = [];
  for (let i = 0; i < state.profiles.length; i++) {
    const roles = [...state.profiles[i].roles].sort().join("+");
    if (selectedRoles && !selectedRoles.includes(roles)) continue;
    const home = expected[roles];
    if (!home) throw new Error("Unspecified role combination in existing data");
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    try {
      await context.addCookies([{ name: "authjs.session-token", value: state.cookies[i], domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
      const p = await context.newPage();
      const pageErrors = [];
      p.on("pageerror", error => pageErrors.push(error.name + ": " + error.message));
      await p.goto(base + "/");
      await p.waitForURL(base + home, { waitUntil: "networkidle" });
      if ((await p.getByRole("link", { name: "Дашборд", exact: true }).count()) !== (home === "/" ? 1 : 0)) throw new Error(roles + ": dashboard menu");
      const text = await p.locator("body").innerText();
      if (text.includes("Проекты в работе") !== (home === "/")) throw new Error(roles + ": dashboard visibility");
      const logo = p.getByRole("link", { name: /PERO CRM/ });
      if ((await logo.getAttribute("href")) !== home) throw new Error(roles + ": logo destination");
      await p.getByRole("link", { name: "Мои задачи", exact: true }).click();
      await p.waitForURL(base + "/my", { waitUntil: "networkidle" });
      await p.getByRole("link", { name: /PERO CRM/ }).click();
      await p.waitForURL(base + home, { waitUntil: "networkidle" });
      await p.goto(base + "/login");
      await p.waitForURL(base + home, { waitUntil: "networkidle" });
      if (roles === "DIRECTOR") {
        if (await p.getByRole("link", { name: "Моя зарплата", exact: true }).count()) throw new Error("director: payroll menu");
        await p.goto(base + "/payroll");
        await p.waitForURL(base + "/", { waitUntil: "networkidle" });
      }
      if (pageErrors.length) throw new Error(roles + ": " + pageErrors.join(", "));
      results.push({ roles, expectedHome: home, signedTestSession: "PASS", directRoot: "PASS", activeLogin: "PASS", sidebar: "PASS", logo: "PASS", pageErrors: 0 });
    } finally {
      await context.close();
    }
  }
  return results;
}
