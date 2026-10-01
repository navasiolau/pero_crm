/** Public NBRB GET only; no CRM/database/container access or TLS bypass. */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { get } from "node:https";

const HOST = "api.nbrb.by";
const date = new Date().toISOString().slice(0, 10);
const URL_FIXED = `https://${HOST}/exrates/rates/USD?parammode=2&ondate=${date}`;
const code = (error) => String(error?.cause?.code ?? error?.code ?? error?.name ?? "UNKNOWN").replace(/[^A-Z0-9_]/gi, "_").slice(0, 80);

async function publicGet(family) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve({ family, ...value }); } };
    const request = get(URL_FIXED, { family, timeout: 10000, rejectUnauthorized: true, servername: HOST }, (response) => {
      const digest = createHash("sha256"); let bytes = 0;
      response.on("data", (chunk) => { bytes += chunk.length; if (bytes <= 65536) digest.update(chunk); else request.destroy(); });
      response.on("end", () => finish({ status: response.statusCode, bytes, sha256: bytes <= 65536 ? digest.digest("hex") : null }));
      response.on("error", (error) => finish({ errorCode: code(error) }));
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    request.on("error", (error) => finish({ errorCode: code(error) }));
  });
}

try {
  const addresses = await lookup(HOST, { all: true });
  const counts = { ipv4: addresses.filter((row) => row.family === 4).length,
    ipv6: addresses.filter((row) => row.family === 6).length };
  const probes = await Promise.all([publicGet(4), ...(counts.ipv6 ? [publicGet(6)] : [])]);
  process.stdout.write(`${JSON.stringify({ target: HOST, date, dns: counts, probes })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "PUBLIC_DNS_FAILED", code: code(error) })}\n`);
  process.exitCode = 1;
}
