import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FinanceDocument, PrismaClient } from "@prisma/client";

/** Только upload adapter: денежные HTTP actions/рассылки не запускаются. */
export async function runBotFinanceDocumentHttp(db: PrismaClient, baseUrl: string,
  verifyAndRemoveOwnObject: (document: FinanceDocument, expected: Buffer) => Promise<void>) {
  const marker = `qa-bot-doc98-${randomUUID()}`, userIds = [marker, `${marker}-manager`], tokenIds = [randomUUID(), randomUUID()];
  async function baseline() {
    const result: Record<string, unknown> = {};
    for (const table of ["User", "ApiToken", "FinanceDocument", "ChangeLog"])
      result[table] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS digest FROM "${table}" t`);
    return result;
  }
  const before = await baseline(), bytes = Buffer.from("%PDF-1.4\nQA98"), mutation = randomUUID();
  const tokens = tokenIds.map(() => `pero_${randomBytes(24).toString("base64url")}`);
  try {
    for (const [index, role] of (["PROCUREMENT", "MANAGER"] as const).entries())
      await db.user.create({ data: { id: userIds[index], name: marker, email: `${userIds[index]}@invalid.local`, passwordHash: "qa-login-disabled", roles: [role] } });
    for (const [index, token] of tokens.entries())
      await db.apiToken.create({ data: { id: tokenIds[index], name: marker, prefix: token.slice(0, 11),
        tokenHash: createHash("sha256").update(token).digest("hex"), scopes: [index === 0 ? "write" : "read"], createdById: userIds[0] } });
    function form() { const data = new FormData(); data.set("clientMutationId", mutation); data.set("file", new File([bytes], "QA bot98.pdf", { type: "application/pdf" })); return data; }
    async function upload(token: string, actor: string, body: BodyInit = "invalid multipart") {
      return fetch(`${baseUrl}/api/v1/bot/documents/upload`, { method: "POST", redirect: "manual",
        headers: { authorization: `Bearer ${token}`, "x-acting-user": actor }, body, signal: AbortSignal.timeout(20000) });
    }
    assert.equal((await upload("invalid", userIds[0])).status, 401);
    assert.equal((await upload(tokens[1], userIds[0])).status, 403);
    assert.equal((await upload(tokens[0], userIds[1])).status, 403);
    const first = await upload(tokens[0], userIds[0], form()); assert.equal(first.status, 201);
    const firstBody = await first.json(); assert.equal(firstBody.ok, true);
    const repeat = await upload(tokens[0], userIds[0], form()); assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).document.id, firstBody.document.id);
    assert.equal(await db.financeDocument.count({ where: { uploadedById: userIds[0] } }), 1);
    const audit = await db.changeLog.findUniqueOrThrow({ where: { id: `finance-document:${firstBody.document.id}` } });
    assert.equal(audit.source, "telegram");
  } finally {
    for (const document of await db.financeDocument.findMany({ where: { uploadedById: { in: userIds } } }))
      await verifyAndRemoveOwnObject(document, bytes);
    await db.$transaction(async tx => {
      await tx.apiToken.deleteMany({ where: { id: { in: tokenIds }, name: marker } });
      await tx.changeLog.deleteMany({ where: { actorId: { in: userIds }, entity: "financeDocument" } });
      await tx.financeDocument.deleteMany({ where: { uploadedById: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds }, name: marker } });
    });
    assert.deepEqual(await baseline(), before, "ORIGINAL_DATA_CHANGED");
  }
  return { status: "PASS", cases: ["bearer-required", "write-scope", "finance-role", "multipart", "exact-retry", "telegram-audit"], originalData: "MATCH", qaRows: 0 };
}
