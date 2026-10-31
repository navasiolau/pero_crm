import assert from 'node:assert/strict';
import test from 'node:test';
import { jobFailureMessage } from '../src/server/kp/job-failure';

test('причина сбоя сообщает шаг и не передаёт произвольный текст исключения', () => {
  assert.match(jobFailureMessage('CONTRACT_DOCX_FAILED'), /собрать файл договора/);
  assert.match(jobFailureMessage('CONTRACT_SOURCE_CHANGED'), /КП или этап/);
  for (const code of [null, 'секретный текст', 'https://private.invalid/password']) {
    const message = jobFailureMessage(code);
    assert.match(message, /номер задания/); assert.equal(code && message.includes(code) || false, false);
  }
});
