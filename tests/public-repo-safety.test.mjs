import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('../fixtures/synthetic/normal-official.json', import.meta.url);

const forbiddenPatterns = [
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /sk-[A-Za-z0-9_-]{10,}/,
  /tenantId\s*[:=]/i,
  /teamId\s*[:=]/i,
  /channelId\s*[:=]/i,
  /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

test('A-7 synthetic fixture does not contain common credential or internal identifier patterns', async () => {
  const text = await readFile(fixtureUrl, 'utf8');
  assert.match(text, /example\.invalid/);

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(text), false, `fixture matched forbidden pattern: ${pattern}`);
  }
});
