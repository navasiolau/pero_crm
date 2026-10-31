import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_SIGNATURE, initializeSignature, signatureFooterWithWarranty, signatureValuesSchema } from '../src/server/kp/signature-defaults';

test('новое КП сохраняет все пять значений, исходные и явно пустые поля остаются собственными', () => {
  const values = INITIAL_SIGNATURE.values;
  const blank = { items: [] };
  const state = initializeSignature(blank, values);
  assert.deepEqual(state.manager, { name: values.managerName, role: values.managerRole, phone: values.managerPhone });
  assert.equal(state.footer, values.footer); assert.equal(state.warrantyMonths, 12);
  assert.deepEqual(blank, { items: [] });
  const custom = initializeSignature({ items: [], manager: { name: '', custom: 'сохранить' }, footer: '', warrantyMonths: null }, values);
  assert.equal((custom.manager as Record<string, unknown>).name, '');
  assert.equal((custom.manager as Record<string, unknown>).role, values.managerRole);
  assert.equal((custom.manager as Record<string, unknown>).custom, 'сохранить');
  assert.equal(custom.footer, ''); assert.equal(custom.warrantyMonths, null);
});

test('гарантия и стандартная фраза подвала согласованы без изменения произвольного текста', () => {
  assert.match(signatureFooterWithWarranty(INITIAL_SIGNATURE.values.footer, 24), /Гарантия — 24 месяца\./);
  assert.equal(signatureFooterWithWarranty('Индивидуальные реквизиты', 24), 'Индивидуальные реквизиты');
  for (const warrantyMonths of [0, -1, 1.5, 1201]) assert.equal(signatureValuesSchema.safeParse({ ...INITIAL_SIGNATURE.values, warrantyMonths }).success, false);
});
