import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getKpTemplateIdentity, type SavedProposalRenderInput } from '@pero/kp-template';
import { renderProposalPdf, renderProposalBundle, renderContractDocx, rasterizeRetainedPdf } from '../src/server/kp/renderer-client';

const identity = getKpTemplateIdentity();
const input: SavedProposalRenderInput = { kind: 'pdf', proposalId: 'proposal', revision: 4, state: { items: [] }, assets: [], templateHash: identity.templateHash };
const secret = 'SYNTHETIC_INTERNAL_RENDERER_SECRET_184';

test('renderer failures preserve safe codes and keep busy/worker failures retryable', async () => {
  for (const [code, status, expectedStatus] of [['KP_RENDER_BUSY', 429, 503], ['KP_RENDER_WORKER_FAILED', 400, 502], ['KP_RENDER_INPUT_INVALID', 400, 400]] as const) {
    await assert.rejects(renderProposalBundle(input, { secret, fetcher: async () => new Response(JSON.stringify({ error: code }), { status }) }),
      error => error instanceof Error && 'code' in error && error.code === code && 'status' in error && error.status === expectedStatus);
  }
});
test('web client calls only internal fixed endpoint and checks PDF identity before publication', async () => {
  let calls = 0;
  const result = await renderProposalPdf(input, { baseUrl: 'http://renderer.invalid:3100', secret, fetcher: async (url, options) => {
    calls++; assert.equal(String(url), 'http://renderer.invalid:3100/v1/render');
    assert.equal((options?.headers as Record<string, string>)['x-pero-renderer-key'], secret);
    assert.deepEqual(JSON.parse(options?.body as string), input); assert.equal(options?.redirect, 'error');
    return new Response(JSON.stringify({ kind: 'pdf', bytesBase64: Buffer.from('%PDF-1.7\nfixture').toString('base64'), pageCount: 65, templateHash: identity.templateHash }));
  } });
  assert.equal(calls, 1); assert.equal(result.bytes.subarray(0, 5).toString(), '%PDF-'); assert.equal(result.pageCount, 65);
});
test('invalid configuration, secret, result version, PDF bytes or mismatched raster pages fail closed', async () => {
  const unexpected: typeof fetch = async () => { throw Error('UNEXPECTED_NETWORK'); };
  await assert.rejects(renderProposalPdf(input, { baseUrl: 'file:///private', secret, fetcher: unexpected }), /CONFIGURATION/);
  await assert.rejects(renderProposalPdf(input, { baseUrl: 'http://renderer.invalid', secret: '', fetcher: unexpected }), /SECRET/);
  for (const patch of [{ templateHash: 'other' }, { bytesBase64: 'invalid' }, { pageCount: 0 }, { pageCount: 1.5 }]) {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ kind: 'pdf', pageCount: 1, templateHash: identity.templateHash,
      bytesBase64: Buffer.from('%PDF-1.7\n').toString('base64'), ...patch }));
    await assert.rejects(renderProposalPdf(input, { secret, fetcher }), /RESPONSE/);
  }
  await assert.rejects(rasterizeRetainedPdf(Buffer.from('%PDF-1.7\n'), { secret,
    fetcher: async () => new Response(JSON.stringify({ kind: 'rasterize', pageCount: 2, pagesBase64: ['aGVsbG8='], templateHash: identity.templateHash })) }), /RESPONSE/);
});

test('fresh proposal bundle and bounded DOCX expose verified bytes through the internal client', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const bundle = await renderProposalBundle(input, { secret, fetcher: async (_url, options) => {
    assert.equal(JSON.parse(options?.body as string).kind, 'bundle');
    return new Response(JSON.stringify({ kind: 'bundle', bytesBase64: Buffer.from('%PDF-1.7\n').toString('base64'), pagesBase64: Array(65).fill(png.toString('base64')), pageCount: 65, templateHash: identity.templateHash }));
  } });
  assert.equal(bundle.pages.length, 65); assert.deepEqual(bundle.pages[0], png);
  const contract = await renderContractDocx({ kind: 'docx', settings: {}, summary: {}, profile: {}, rendered: [], templateHash: identity.templateHash }, { secret,
    fetcher: async (_url, options) => {
      assert.equal((options?.headers as Record<string, string>)['x-pero-renderer-kind'], 'docx');
      return new Response(JSON.stringify({ kind: 'docx', bytesBase64: Buffer.from('PK-fixture').toString('base64'), pageCount: 65, templateHash: identity.templateHash }));
    } });
  assert.equal(contract.bytes.toString(), 'PK-fixture');
  const raster = await rasterizeRetainedPdf(Buffer.from('%PDF-1.7\n'), { secret,
    fetcher: async () => new Response(JSON.stringify({ kind: 'rasterize', pagesBase64: Array(65).fill(png.toString('base64')), pageCount: 65, templateHash: identity.templateHash })) });
  assert.equal(raster.pages.length, 65);
});
