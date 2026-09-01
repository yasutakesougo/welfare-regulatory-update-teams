import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ELIGIBILITY,
  IMPACT_LEVEL,
  RELEVANCE,
  UNCERTAINTY,
  SliceBValidationError,
} from '../../src/contracts/slice-b.mjs';
import { assessImpact } from '../../src/impact/classifier.mjs';

const text = '生活介護の運用を変更する。施行日は2026年9月10日。';
const hash = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const idxChange = text.indexOf('生活介護の運用を変更する。');
const idxDeadline = text.indexOf('施行日は2026年9月10日。');

function base(overrides = {}) {
  return {
    evidence: {
      EvidenceId: 'EV-SYN-001', SourceAuthority: 'OFFICIAL_GOVERNMENT', DocumentTitle: '合成通知', DocumentType: 'NOTICE',
      PublishedAt: '2026-09-01T00:00:00Z', EffectiveAt: '2026-09-10T00:00:00Z', SourceUrl: 'https://example.invalid/official/1',
      CanonicalSourceUrl: 'https://example.invalid/official/1', ContentHash: hash, RetrievedAt: '2026-09-01T01:00:00Z',
      ApplicableServices: ['生活介護'], EvidenceStatus: 'VERIFIED_OFFICIAL', Jurisdiction: 'JP',
    },
    material: { EvidenceId: 'EV-SYN-001', EvidenceContentHash: hash, materialText: text, materialType: 'FULL_TEXT' },
    currentState: { EvidenceId: 'EV-SYN-001', state: 'CURRENT', resolutionBasisId: 'SYN-STATE-1' },
    targetContext: { targetServices: ['生活介護'], targetRoles: ['管理者'], targetTopics: ['運営'], jurisdiction: 'JP', jurisdictionRelation: 'MATCH' },
    assessmentPolicy: { assessmentAt: '2026-09-01T00:00:00Z', urgentWithinDays: 3 },
    groundedSignals: [{ kind: 'FACT', text: '生活介護の運用を変更する。', startOffset: idxChange, endOffset: idxChange + '生活介護の運用を変更する。'.length }],
    executionMode: 'NORMAL',
    ...overrides,
  };
}
const opt = { idGenerator: () => 'IMPACT-SYN-001' };

test('B-1 relevant grounded FULL_TEXT yields internal draft', () => {
  const result = assessImpact(base(), opt);
  assert.equal(result.eligibility, ELIGIBILITY.ELIGIBLE_INTERNAL_DRAFT);
  assert.equal(result.relevance, RELEVANCE.RELEVANT);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.INFO);
  assert.equal(result.TeamsDraft.changeSummary, result.SourceFactSummary);
  assert.equal(result.PublicationAuthorization, 'NOT_AUTHORIZED');
  assert.equal(result.DraftReviewStatus, 'NOT_REVIEWED');
});

test('B-2 pending review preserves EVIDENCE_NOT_VERIFIED', () => {
  const input = base();
  input.evidence = { ...input.evidence, EvidenceStatus: 'OFFICIAL_PENDING_REVIEW' };
  const result = assessImpact(input, opt);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.EVIDENCE_NOT_VERIFIED));
  assert.match(result.TeamsDraft.reviewNotice, /公式資料・内容確認中/);
});

test('B-3 unknown effective date is not guessed', () => {
  const input = base();
  const { EffectiveAt, ...evidence } = input.evidence;
  input.evidence = evidence;
  const result = assessImpact(input, opt);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.EFFECTIVE_DATE_UNKNOWN));
  assert.equal(result.TeamsDraft.effectiveDateText, '要確認');
});

test('B-4 empty service intersection fails safe to POSSIBLY_RELEVANT/CHECK', () => {
  const input = base();
  input.targetContext = { ...input.targetContext, targetServices: ['共同生活援助'] };
  const result = assessImpact(input, opt);
  assert.equal(result.relevance, RELEVANCE.POSSIBLY_RELEVANT);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.CHECK);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.RELEVANCE_UNCERTAIN));
});

test('B-5 jurisdiction OUTSIDE is NOT_ELIGIBLE with no draft', () => {
  const input = base();
  input.targetContext = { ...input.targetContext, jurisdictionRelation: 'OUTSIDE' };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.NOT_ELIGIBLE);
  assert.equal(result.TeamsDraft, undefined);
});

test('B-6 ACTION_REQUIRED wording is triage, not mandatory command', () => {
  const input = base();
  input.groundedSignals = [{ kind: 'CHANGE', text: '生活介護の運用を変更する。', startOffset: idxChange, endOffset: idxChange + '生活介護の運用を変更する。'.length }];
  const result = assessImpact(input, opt);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.ACTION_REQUIRED);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.OBLIGATION_UNCONFIRMED));
  assert.doesNotMatch(result.TeamsDraft.potentialImpact, /必ず|義務です|しなければならない/);
});

test('B-7 future urgency window is deterministic', () => {
  const input = base();
  input.assessmentPolicy = { assessmentAt: '2026-09-08T00:00:00Z', urgentWithinDays: 2 };
  input.groundedSignals = [{ kind: 'FACT', text: '生活介護の運用を変更する。', startOffset: idxChange, endOffset: idxChange + '生活介護の運用を変更する。'.length }];
  const result = assessImpact(input, opt);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.URGENT_REVIEW);
});

test('B-8 past EffectiveAt alone does not trigger urgent review', () => {
  const input = base();
  input.assessmentPolicy = { assessmentAt: '2026-09-12T00:00:00Z', urgentWithinDays: 10 };
  input.groundedSignals = [{ kind: 'FACT', text: '生活介護の運用を変更する。', startOffset: idxChange, endOffset: idxChange + '生活介護の運用を変更する。'.length }];
  const result = assessImpact(input, opt);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.INFO);
});

test('B-9/B-10 superseded and withdrawn are not eligible', () => {
  for (const state of ['SUPERSEDED', 'WITHDRAWN']) {
    const input = base();
    input.currentState = { ...input.currentState, state };
    const result = assessImpact(input, opt);
    assert.equal(result.eligibility, ELIGIBILITY.NOT_ELIGIBLE);
    assert.equal(result.TeamsDraft, undefined);
  }
});

test('B-11 unresolved current state is REVIEW_ONLY', () => {
  const input = base();
  input.currentState = { ...input.currentState, state: 'UNRESOLVED' };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.SUPERSESSION_UNRESOLVED));
});

test('B-12 sourceFactSummary is exact grounded source text', () => {
  const input = base();
  input.groundedSignals = [
    { kind: 'CHANGE', text: '生活介護の運用を変更する。', startOffset: idxChange, endOffset: idxChange + '生活介護の運用を変更する。'.length },
    { kind: 'DEADLINE', text: '施行日は2026年9月10日。', startOffset: idxDeadline, endOffset: idxDeadline + '施行日は2026年9月10日。'.length },
  ];
  const result = assessImpact(input, opt);
  assert.equal(result.SourceFactSummary, '生活介護の運用を変更する。\n施行日は2026年9月10日。');
  assert.equal(result.TeamsDraft.changeSummary, result.SourceFactSummary);
});

test('B-13 FULL_TEXT hash mismatch is REVIEW_ONLY', () => {
  const input = base();
  input.material = { ...input.material, materialText: `${text}改変` };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.MATERIAL_MISMATCH));
  assert.equal(result.TeamsDraft, undefined);
});

test('B-14 SUPPLIED_EXCERPT is REVIEW_ONLY', () => {
  const input = base();
  input.material = { ...input.material, materialType: 'SUPPLIED_EXCERPT' };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.equal(result.TeamsDraft, undefined);
});

test('B-15 jurisdiction UNKNOWN never auto-NOT_RELEVANT', () => {
  const input = base();
  input.targetContext = { ...input.targetContext, jurisdictionRelation: 'UNKNOWN' };
  const result = assessImpact(input, opt);
  assert.equal(result.relevance, RELEVANCE.POSSIBLY_RELEVANT);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.JURISDICTION_UNKNOWN));
});

test('B-19 generated authority states never elevate', () => {
  const result = assessImpact(base(), opt);
  assert.equal(result.DraftReviewStatus, 'NOT_REVIEWED');
  assert.equal(result.PublicationAuthorization, 'NOT_AUTHORIZED');
});

test('B-21 synthetic fixture cannot enter NORMAL draft path', () => {
  const input = base();
  input.material = { ...input.material, materialType: 'SYNTHETIC_FIXTURE' };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.equal(result.TeamsDraft, undefined);
});

test('B-22 exact service match cannot be suppressed by caller service relation', () => {
  const input = base();
  input.targetContext = { ...input.targetContext, serviceRelation: 'OUTSIDE' };
  const result = assessImpact(input, opt);
  assert.equal(result.relevance, RELEVANCE.RELEVANT);
});

test('B-23 zero grounded signals are REVIEW_ONLY', () => {
  const input = base();
  input.groundedSignals = [];
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.SOURCE_FACT_UNAVAILABLE));
  assert.equal(result.TeamsDraft, undefined);
});

test('signal offset mismatch is typed structural failure without raw material in error', () => {
  const input = base();
  input.groundedSignals = [{ kind: 'FACT', text: 'wrong', startOffset: 0, endOffset: 5 }];
  assert.throws(() => assessImpact(input, opt), (error) => {
    assert.ok(error instanceof SliceBValidationError);
    assert.equal(error.code, 'INVALID_GROUNDED_SIGNAL');
    assert.doesNotMatch(error.message, /生活介護/);
    return true;
  });
});

test('inputs are not mutated', () => {
  const input = base();
  const before = structuredClone(input);
  assessImpact(input, opt);
  assert.deepEqual(input, before);
});

test('synthetic fixture is accepted only in SYNTHETIC_ACCEPTANCE mode', () => {
  const input = base();
  input.material = { ...input.material, materialType: 'SYNTHETIC_FIXTURE' };
  input.executionMode = 'SYNTHETIC_ACCEPTANCE';
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.ELIGIBLE_INTERNAL_DRAFT);
});

test('current-state conflict is REVIEW_ONLY and never produces a normal draft', () => {
  const input = base();
  input.evidence = { ...input.evidence, EvidenceStatus: 'SUPERSEDED' };
  input.currentState = { ...input.currentState, state: 'CURRENT' };
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.equal(result.relevance, RELEVANCE.UNKNOWN);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.CURRENT_STATE_CONFLICT));
  assert.equal(result.TeamsDraft, undefined);
});

test('pending Evidence preserves EVIDENCE_NOT_VERIFIED on missing-material REVIEW_ONLY path', () => {
  const input = base();
  input.evidence = { ...input.evidence, EvidenceStatus: 'OFFICIAL_PENDING_REVIEW' };
  input.material = null;
  const result = assessImpact(input, opt);
  assert.equal(result.eligibility, ELIGIBILITY.REVIEW_ONLY);
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.EVIDENCE_NOT_VERIFIED));
  assert.ok(result.UncertaintyFlags.includes(UNCERTAINTY.MATERIAL_UNAVAILABLE));
});

test('discovery-only SourceAuthority is rejected', () => {
  const input = base();
  input.evidence = { ...input.evidence, SourceAuthority: 'BLOG' };
  assert.throws(() => assessImpact(input, opt), (error) => {
    assert.ok(error instanceof SliceBValidationError);
    assert.equal(error.code, 'INVALID_EVIDENCE');
    assert.ok(error.issues.includes('SourceAuthority'));
    return true;
  });
});

test('DEADLINE signal alone does not bypass urgency future-window policy', () => {
  const input = base();
  input.assessmentPolicy = { assessmentAt: '2026-09-01T00:00:00Z', urgentWithinDays: 0 };
  input.groundedSignals = [{ kind: 'DEADLINE', text: '施行日は2026年9月10日。', startOffset: idxDeadline, endOffset: idxDeadline + '施行日は2026年9月10日。'.length }];
  const result = assessImpact(input, opt);
  assert.equal(result.ImpactLevel, IMPACT_LEVEL.INFO);
});

test('RelevantServices reports exact intersection only', () => {
  const input = base();
  input.evidence = { ...input.evidence, ApplicableServices: ['生活介護', '共同生活援助'] };
  const result = assessImpact(input, opt);
  assert.deepEqual(result.RelevantServices, ['生活介護']);

  input.targetContext = { ...input.targetContext, targetServices: ['就労継続支援B型'] };
  const uncertain = assessImpact(input, opt);
  assert.equal(uncertain.relevance, RELEVANCE.POSSIBLY_RELEVANT);
  assert.deepEqual(uncertain.RelevantServices, []);
});
