const assert = require('node:assert/strict');
const { test } = require('node:test');
const { localWins, createClock } = require('../assets/public/js/kp-local-state.js');
const remote = { revision: 31, canEdit: true, updatedAt: new Date(3000).toISOString(), state: { items: [], footer: 'SERVER' }, fx: null, client: null };
const draft = time => ({ editedAt: time, baseRevision: 29, local: { state: { items: [], footer: 'LOCAL' }, fx: null, client: null } });

test('whole snapshot selection uses actual time, server ties, valid legacy base and causal ACK', () => {
  assert.equal(localWins(draft(2999), remote), false);
  assert.equal(localWins(draft(3000), remote), false);
  assert.equal(localWins(draft(3001), remote), true);
  assert.equal(localWins(draft(0), remote), false);
  assert.equal(localWins({ ...draft(0), baseRevision: 31 }, remote), true);
  assert.equal(localWins({ ...draft(2999), followsRevision: 31 }, remote), true);
  assert.equal(localWins(draft(4000), { ...remote, canEdit: false }), false);
  assert.equal(localWins({ ...draft(4000), local: { state: remote.state, fx: null, client: null } }, remote), false);
});

test('edit clock follows server time and monotonic elapsed time, with no client wall clock', t => {
  let elapsed = 100; const clock = createClock(() => elapsed);
  assert.equal(clock.now(), null); clock.sample(null, 90); assert.equal(clock.now(), null);
  clock.sample('10000', 90); assert.equal(clock.now(), 10005);
  t.mock.method(Date, 'now', () => 99_999_999_999_999);
  elapsed = 175; assert.equal(clock.now(), 10080);
  clock.sample('invalid', 170); assert.equal(clock.now(), 10080);
});
