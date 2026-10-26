#!/usr/bin/env node
// Единый HTTP-клиент для MCP и Python; ключ передаётся только через окружение.
import { KpApiClient, KpApiError } from './client.mjs';

async function main() {
  const chunks = []; let size = 0;
  for await (const part of process.stdin) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); size += chunk.byteLength;
    if (size > 2_147_483_647) throw new KpApiError('KP_REQUEST_TOO_LARGE', 'Запрос слишком большой.');
    chunks.push(chunk);
  }
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  if (input.action !== 'save' && size > 2 * 1024 * 1024) throw new KpApiError('KP_REQUEST_TOO_LARGE', 'Запрос слишком большой.');
  const client = new KpApiClient({ baseUrl: process.env.PERO_CRM_API_URL, key: process.env.PERO_CRM_API_KEY });
  const args = input.args || {};
  let result;
  switch (input.action) {
    case 'list': result = await client.listDocuments(args.query); break;
    case 'get': result = await client.getDocument(args.id); break;
    case 'clients': result = await client.findClients(args.query); break;
    case 'client': result = await client.getClient(args.id); break;
    case 'save': result = await client.save(args); break;
    case 'upload': result = await client.upload(args); break;
    case 'versions': result = await client.listVersions(args.id); break;
    case 'version': result = await client.getVersion(args.id, args.versionId); break;
    case 'restore': result = await client.restore(args.id, args.versionId, args.expectedRevision, args.operationId); break;
    case 'pdf': result = await client.generatePdf(args.id, args.expectedRevision, args.operationId); break;
    case 'contract': result = await client.getContract(args.id); break;
    case 'save-contract': result = await client.saveContract(args.id, args.settings, args.expectedRevision, args.clientBaseline, args.sourceRefs, args.operationId); break;
    case 'generate-contract': result = await client.generateContract(args.id, args.expectedRevision, args.sourceRefs, args.clientBaseline, args.operationId); break;
    case 'job': result = args.wait ? await client.waitJob(args.id, { timeoutMs: args.timeoutMs }) : await client.getJob(args.id); break;
    case 'operation': result = await client.getOperation(args.id); break;
    case 'artifact': case 'media': {
      const data = input.action === 'artifact' ? await client.downloadArtifact(args.id) : await client.downloadMedia(args.documentId, args.id, args);
      result = { base64: data.bytes.toString('base64'), mimeType: data.mimeType }; break;
    }
    default: throw new KpApiError('KP_ACTION_INVALID', 'Неизвестная операция помощника.');
  }
  process.stdout.write(JSON.stringify({ ok: true, result }));
}
main().catch(error => {
  const safe = error instanceof KpApiError ? { code: error.code, message: error.message, ...(error.operationId ? { operationId: error.operationId } : {}) } : { code: 'KP_HELPER_FAILED', message: 'Операция помощника не завершена. Проверьте аргументы и локальные файлы.' };
  process.stdout.write(JSON.stringify({ ok: false, error: safe }));
  process.exitCode = 1;
});
