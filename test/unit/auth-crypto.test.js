import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, fromB64, isSealed, makeCodec, open, openVault, passwordStrength, rewrapVault, seal, toB64 } from '../../src/app/crypto.js';
import { createAuth, FREE_ATTEMPTS, memoryAuthStorage, validateNewAccount } from '../../src/app/auth.js';

// Low iteration counts keep the suite fast; production uses 310,000.
const FAST = { iterations: 2000 };

test('base64 round-trips arbitrary bytes, including large ones', () => {
  const big = new Uint8Array(200_000);
  for (let i = 0; i < big.length; i += 65_536) crypto.getRandomValues(big.subarray(i, i + 65_536)); // 64 KB per call limit
  assert.deepEqual(fromB64(toB64(big)), big);
});

test('vault: right password opens it, wrong password does not', async () => {
  const { vault, key } = await createVault('correct horse battery', FAST);
  assert.equal(vault.iterations, 2000);
  const again = await openVault(vault, 'correct horse battery');
  assert.ok(again);
  assert.equal(await openVault(vault, 'correct horse batterY'), null);
  assert.equal(await openVault(vault, ''), null);
  // the same data key comes back: what one key sealed, the other opens
  const sealed = await seal(key, { hello: 'world' }, 'meta:x');
  assert.deepEqual(await open(again, sealed, 'meta:x'), { hello: 'world' });
});

test('vault: data key is non-extractable', async () => {
  const { key } = await createVault('another-long-password', FAST);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
  assert.equal(key.extractable, false);
});

test('vault: refuses absurd or tampered key-derivation settings', async () => {
  const { vault } = await createVault('another-long-password', FAST);
  await assert.rejects(() => openVault({ ...vault, iterations: 10 }, 'x'), /Unsupported/);
  await assert.rejects(() => openVault({ ...vault, iterations: 900_000_000 }, 'x'), /Unsupported/);
});

test('vault: tampered wrapped key does not open', async () => {
  const { vault } = await createVault('another-long-password', FAST);
  const bytes = fromB64(vault.wrapped);
  bytes[0] ^= 1;
  assert.equal(await openVault({ ...vault, wrapped: toB64(bytes) }, 'another-long-password'), null);
});

test('rewrap: new password works, old one stops working, data stays readable', async () => {
  const { vault, key } = await createVault('first-password-1', FAST);
  const sealed = await seal(key, [1, 2, 3], 'events:a');
  const moved = await rewrapVault(vault, 'first-password-1', 'second-password-2', FAST);
  assert.ok(moved);
  assert.equal(await openVault(moved.vault, 'first-password-1'), null);
  const k2 = await openVault(moved.vault, 'second-password-2');
  assert.deepEqual(await open(k2, sealed, 'events:a'), [1, 2, 3]);
  assert.notEqual(moved.vault.salt, vault.salt, 'fresh salt');
  assert.equal(await rewrapVault(vault, 'wrong', 'whatever-123', FAST), null);
});

test('seal/open: unique IV, tamper detection, slot binding, wrong key', async () => {
  const { key } = await createVault('seal-test-password', FAST);
  const other = (await createVault('another-password-x', FAST)).key;
  const value = { title: 'Secret meetup', n: 7 };
  const a = await seal(key, value, 'events:1');
  const b = await seal(key, value, 'events:1');
  assert.ok(isSealed(a));
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct, 'same plaintext never encrypts the same twice');
  assert.ok(!JSON.stringify(a).includes('Secret'), 'plaintext is not visible');
  assert.deepEqual(await open(key, a, 'events:1'), value);

  const flipped = fromB64(a.ct);
  flipped[3] ^= 0xff;
  await assert.rejects(() => open(key, { ...a, ct: toB64(flipped) }, 'events:1'));
  await assert.rejects(() => open(key, a, 'events:2'), undefined, 'ciphertext moved to another record');
  await assert.rejects(() => open(other, a, 'events:1'), undefined, 'wrong key');
});

test('codec encodes and decodes through a key', async () => {
  const { key } = await createVault('codec-test-password', FAST);
  const codec = makeCodec(key);
  const sealed = await codec.encode('meta:settings', { a: 1 });
  assert.deepEqual(await codec.decode('meta:settings', sealed), { a: 1 });
});

test('passwordStrength rewards length and variety, punishes the obvious', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('aaaaaaaa').score, 0);
  assert.equal(passwordStrength('password').score, 0);
  assert.ok(passwordStrength('abcdefgh').score <= 1);
  assert.ok(passwordStrength('Tr0ub4dor&3xyz').score >= 3);
  assert.ok(passwordStrength('correct horse battery staple').score >= 3);
  assert.equal(passwordStrength('x'.repeat(40)).score, 0, 'repeated character');
});

test('validateNewAccount', () => {
  assert.deepEqual(validateNewAccount('Sudha', 'longenough1'), {});
  assert.ok(validateNewAccount('', 'longenough1').name);
  assert.ok(validateNewAccount('  \u0000 ', 'longenough1').name);
  assert.ok(validateNewAccount('S', 'short').password);
  assert.ok(validateNewAccount('S', '          ').password);
  assert.ok(validateNewAccount('S', 'x'.repeat(201)).password);
});

test('auth: sign up, sign in, wrong password, lockout with backoff, recovery', async () => {
  let t = 1_000_000;
  const auth = createAuth(memoryAuthStorage(), { now: () => t, ...FAST });
  assert.equal(await auth.getProfile(), null);
  assert.deepEqual((await auth.signUp('Sudha', 'short')).errors?.password?.length > 0, true);

  const up = await auth.signUp('  Sudha  ', 'my-long-password');
  assert.ok(up.ok);
  assert.equal(up.profile.name, 'Sudha');
  assert.equal((await auth.signUp('Again', 'my-long-password')).ok, false, 'one account per device');

  for (let i = 1; i < FREE_ATTEMPTS; i++) {
    const r = await auth.signIn('wrong-password');
    assert.equal(r.reason, 'wrong');
    assert.equal(r.attemptsLeft, FREE_ATTEMPTS - i);
  }
  const fifth = await auth.signIn('wrong-password');
  assert.equal(fifth.reason, 'locked');
  assert.equal(fifth.waitMs, 30_000);

  // even the right password is refused during the lockout
  const during = await auth.signIn('my-long-password');
  assert.equal(during.reason, 'locked');

  t += 30_001;
  const again = await auth.signIn('wrong-password');
  assert.equal(again.waitMs, 60_000, 'wait doubles');
  t += 60_001;
  const ok = await auth.signIn('my-long-password');
  assert.ok(ok.ok);
  assert.equal((await auth.getProfile()).failed, 0, 'counter resets on success');
});

test('auth: lockout is capped at 15 minutes', async () => {
  let t = 5_000_000;
  const auth = createAuth(memoryAuthStorage(), { now: () => t, ...FAST });
  await auth.signUp('A', 'my-long-password');
  let last;
  for (let i = 0; i < 20; i++) {
    last = await auth.signIn('nope-nope-nope');
    t += (last.waitMs ?? 0) + 1;
  }
  assert.equal(last.waitMs, 15 * 60_000);
});

test('auth: "keep me signed in" resumes, expires after 30 days, and lock() ends it', async () => {
  let t = 10_000_000;
  const auth = createAuth(memoryAuthStorage(), { now: () => t, ...FAST });
  await auth.signUp('A', 'my-long-password', { keep: false });
  assert.equal(await auth.resume(), null, 'not remembered by default');

  await auth.signIn('my-long-password', { keep: true });
  assert.ok(await auth.resume());
  t += 29 * 24 * 3600_000;
  assert.ok(await auth.resume());
  t += 2 * 24 * 3600_000;
  assert.equal(await auth.resume(), null, 'expired');

  await auth.signIn('my-long-password', { keep: true });
  await auth.lock();
  assert.equal(await auth.resume(), null);
});

test('auth: change password, rename, idle setting, reset', async () => {
  const auth = createAuth(memoryAuthStorage(), FAST);
  await auth.signUp('A', 'my-long-password');
  assert.ok((await auth.changePassword('bad', 'new-long-password')).errors.oldPassword);
  assert.ok((await auth.changePassword('my-long-password', 'tiny')).errors.newPassword);
  assert.ok((await auth.changePassword('my-long-password', 'new-long-password')).ok);
  assert.equal((await auth.signIn('my-long-password')).ok, false);
  assert.ok((await auth.signIn('new-long-password')).ok);

  assert.equal(await auth.rename('  Sudha M  '), true);
  assert.equal(await auth.rename('   '), false);
  assert.equal((await auth.getProfile()).name, 'Sudha M');
  await auth.setIdleMinutes(15);
  await auth.setIdleMinutes(7);
  assert.equal((await auth.getProfile()).idleMinutes, 15, 'unsupported values ignored');

  await auth.reset();
  assert.equal(await auth.getProfile(), null);
  assert.equal((await auth.signIn('new-long-password')).reason, 'none');
});
