import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  COMPARISON,
  EVIDENCE_STATUS,
  EvidenceValidationError,
  computeContentHash,
  normalizeEvidence,
} from '../src/evidence/normalizer.mjs';

const fixtureUrl = new URL('../fixtures/synthetic/normal-official.json', import.meta.url);
const baseInput = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const stableId = () => 'EV-SYNTHETIC-001';

function normalize(input = baseInput, options = {}) {
  return normalizeEvidence(input, { idGenerator: stableId, ...options });
}

test('A-1 normal official evidence normalizes to pending review', () => {
  const result = normalize();

  assert.equal(result.comparison, COMPARISON.NEW);
  assert.equal(result.evidence.EvidenceId, 'EV-SYNTHETIC-001');
  assert.equal(result.evidence.EvidenceStatus, EVIDENCE_STATUS.OFFICIAL_PENDING_REVIEW);
  assert.equal(result.evidence.CanonicalSourceUrl, baseInput.sourceUrl);
  assert.equal(result.evidence.ContentHash, computeContentHash(baseInput.rawContent));
  assert.equal('unexpectedField' in result.evidence, false);
});

test('A-2 unknown effective date remains absent', () => {
  const result = normalize();
  assert.equal('EffectiveAt' in result.evidence, false);
});

test('A-3 same source and same content is SAME_CONTENT', () => {
  const first = normalize();
  const second = normalize(baseInput, { priorEvidence: first.evidence });

  assert.equal(second.comparison, COMPARISON.SAME_CONTENT);
  assert.equal(second.priorEvidenceId, first.evidence.EvidenceId);
});

test('A-4 same source with changed content is CONTENT_CHANGED without prior mutation', () => {
  const first = normalize();
  const priorSnapshot = structuredClone(first.evidence);
  const changedInput = { ...baseInput, rawContent: `${baseInput.rawContent}\nCorrection.` };
  const changed = normalize(changedInput, { priorEvidence: first.evidence });

  assert.equal(changed.comparison, COMPARISON.CONTENT_CHANGED);
  assert.notEqual(changed.evidence.ContentHash, first.evidence.ContentHash);
  assert.deepEqual(first.evidence, priorSnapshot);
});

test('A-5 different URL with same content is NEW when no shared document identity exists', () => {
  const first = normalize();
  const movedInput = {
    ...baseInput,
    sourceUrl: 'https://example.invalid/regulations/notice-002',
  };
  const moved = normalize(movedInput, { priorEvidence: first.evidence });

  assert.equal(moved.comparison, COMPARISON.NEW);
  assert.equal(moved.evidence.ContentHash, first.evidence.ContentHash);
});

test('explicit shared sourceDocumentId can resolve identity across different URLs', () => {
  const firstInput = { ...baseInput, sourceDocumentId: 'DOC-SYNTHETIC-001' };
  const first = normalize(firstInput);
  const secondInput = {
    ...firstInput,
    sourceUrl: 'https://example.invalid/alternate/notice-001',
  };
  const second = normalize(secondInput, { priorEvidence: first.evidence });

  assert.equal(second.comparison, COMPARISON.SAME_CONTENT);
});

test('A-6 normalizer never creates VERIFIED_OFFICIAL', () => {
  const result = normalize({ ...baseInput, verifiedOfficial: true });
  assert.equal(result.evidence.EvidenceStatus, EVIDENCE_STATUS.OFFICIAL_PENDING_REVIEW);
});

test('explicit supersedesEvidenceId is preserved but not inferred', () => {
  const explicit = normalize({ ...baseInput, supersedesEvidenceId: 'EV-SYNTHETIC-OLD' });
  assert.equal(explicit.evidence.SupersedesEvidenceId, 'EV-SYNTHETIC-OLD');

  const absent = normalize();
  assert.equal('SupersedesEvidenceId' in absent.evidence, false);
});

test('canonicalSourceUrl preserves supplied value exactly', () => {
  const canonicalSourceUrl = 'https://example.invalid/canonical/notice-001?version=1';
  const result = normalize({ ...baseInput, canonicalSourceUrl });
  assert.equal(result.evidence.CanonicalSourceUrl, canonicalSourceUrl);
});

test('resolved different source identities are NEW', () => {
  const first = normalize({ ...baseInput, sourceDocumentId: 'DOC-A' });
  const second = normalize(
    { ...baseInput, sourceDocumentId: 'DOC-B' },
    { priorEvidence: first.evidence },
  );
  assert.equal(second.comparison, COMPARISON.NEW);
});

test('unresolvable prior identity returns IDENTITY_UNRESOLVED', () => {
  const priorEvidence = {
    EvidenceId: 'EV-PRIOR',
    ContentHash: computeContentHash(baseInput.rawContent),
  };
  const result = normalize(baseInput, { priorEvidence });
  assert.equal(result.comparison, COMPARISON.IDENTITY_UNRESOLVED);
});

test('invalid required field returns typed validation failure and no partial evidence', () => {
  assert.throws(
    () => normalizeEvidence({ ...baseInput, documentTitle: '' }, { idGenerator: stableId }),
    (error) => {
      assert.equal(error instanceof EvidenceValidationError, true);
      assert.equal(error.code, 'EVIDENCE_VALIDATION_ERROR');
      assert.match(error.issues.join('\n'), /documentTitle/);
      return true;
    },
  );
});

test('embedded URL credentials are rejected', () => {
  assert.throws(
    () => normalizeEvidence(
      { ...baseInput, sourceUrl: 'https://user:secret@example.invalid/notice' },
      { idGenerator: stableId },
    ),
    EvidenceValidationError,
  );
});
