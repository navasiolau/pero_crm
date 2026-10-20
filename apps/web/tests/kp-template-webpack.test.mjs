import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import test from 'node:test';
import exportedNextConfig from '../next.config.ts';

const app = path.resolve(import.meta.dirname, '..'), require = createRequire(path.join(app, 'package.json'));
const nextConfig = exportedNextConfig.default ?? exportedNextConfig;
const compiledWebpack = require('next/dist/compiled/webpack/webpack'); compiledWebpack.init();
const webpack = compiledWebpack.webpack;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('Next server compiler preserves package dirname for identity and assets', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pero-kp-webpack-'));
  try {
    const chunk = path.join(directory, '.next/server/chunks'); await mkdir(chunk, { recursive: true });
    const entry = path.join(directory, 'entry.mjs');
    await writeFile(entry, "import {getKpTemplateIdentity,browserAsset} from '@pero/kp-template';export const identity=()=>getKpTemplateIdentity();export const asset=()=>browserAsset('public/js/sheet-render.js');");
    const base = { mode: 'none', target: 'node22', context: app, entry: async () => ({ main: entry }), output: { path: chunk, filename: 'template.cjs', library: { type: 'commonjs2' } },
      resolve: { modules: [path.join(app, 'node_modules'), 'node_modules'] }, node: { __dirname: false, __filename: false }, externals: [], plugins: [] };
    const options = { isServer: true, dev: false, dir: app, config: { basePath: '' }, webpack, nextRuntime: 'nodejs' };
    const configured = await nextConfig.webpack(base, options);
    // Настоящий compiler Next с production hook после Serwist wrapper.
    await new Promise((resolve, reject) => {
      const compiler = webpack(configured);
      compiler.run((error, stats) => compiler.close(closeError => error || closeError || stats?.hasErrors() ? reject(error ?? closeError ?? Error(stats.toString({ all: false, errors: true }))) : resolve()));
    });
    const source = await readFile(path.join(chunk, 'template.cjs'), 'utf8'), compiledModule = { exports: {} };
    new Script(source, { filename: path.join(chunk, 'template.cjs') }).runInNewContext({ require, module: compiledModule, exports: compiledModule.exports, __dirname: chunk, __filename: path.join(chunk, 'template.cjs'), process, Buffer, console });
    const expected = require('@pero/kp-template');
    assert.deepEqual(compiledModule.exports.identity(), expected.getKpTemplateIdentity());
    assert.equal(sha(compiledModule.exports.asset()), sha(expected.browserAsset('public/js/sheet-render.js')));
    const untouched = [{ preserved: true }], client = await nextConfig.webpack({ ...base, externals: untouched }, { ...options, isServer: false });
    assert.equal(client.externals, untouched);
    let subpath;
    configured.externals[0]({ request: '@pero/kp-template/browser' }, (_error, result) => { subpath = result; });
    assert.equal(subpath, undefined);
  } finally {
    const resolved = await realpath(directory);
    assert.equal(resolved, path.resolve(directory)); assert.ok(path.basename(resolved).startsWith('pero-kp-webpack-'));
    await rm(resolved, { recursive: true, force: false });
  }
});
