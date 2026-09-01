import { IMPACT_LEVEL } from '../contracts/slice-b.mjs';

const TEXT = Object.freeze({
  [IMPACT_LEVEL.INFO]: Object.freeze({
    potentialImpact: '対象業務への影響有無を確認してください。',
    suggestedCheck: '公式資料の対象範囲と現行運用を照合してください。',
  }),
  [IMPACT_LEVEL.CHECK]: Object.freeze({
    potentialImpact: '対象となる可能性があるため確認が必要です。',
    suggestedCheck: '管理者・担当者で適用範囲を確認してください。',
  }),
  [IMPACT_LEVEL.ACTION_REQUIRED]: Object.freeze({
    potentialImpact: '対応検討が必要となる可能性があります。',
    suggestedCheck: '根拠箇所と現行運用をHuman Reviewで確認してください。',
  }),
  [IMPACT_LEVEL.URGENT_REVIEW]: Object.freeze({
    potentialImpact: '優先して確認すべき可能性があります。',
    suggestedCheck: '施行日・期限と対象範囲を優先確認してください。',
  }),
});

export function renderAssessmentText(impactLevel) {
  const entry = TEXT[impactLevel];
  if (!entry) throw new TypeError('unsupported impact level');
  return entry;
}

export function renderTeamsDraft({
  evidence,
  targetContext,
  impactLevel,
  sourceFactSummary,
  uncertaintyFlags,
}) {
  const { potentialImpact, suggestedCheck } = renderAssessmentText(impactLevel);
  const targetSummary = targetContext.targetServices.join(' / ');
  const effectiveDateText = evidence.EffectiveAt ?? '要確認';
  const notices = [];

  if (evidence.EvidenceStatus === 'OFFICIAL_PENDING_REVIEW') {
    notices.push('公式資料・内容確認中');
  }
  if (uncertaintyFlags.length > 0) {
    notices.push(`要確認: ${uncertaintyFlags.join(', ')}`);
  }

  return Object.freeze({
    heading: '【制度改定情報・Human Review用】',
    changeSummary: sourceFactSummary,
    targetSummary,
    effectiveDateText,
    sourceFactSummary,
    potentialImpact,
    suggestedCheck,
    impactLabel: impactLevel,
    evidenceId: evidence.EvidenceId,
    sourceAuthority: evidence.SourceAuthority,
    sourceUrl: evidence.SourceUrl,
    reviewNotice: notices.join(' / ') || 'Human Review required',
  });
}
