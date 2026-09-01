import { createHash, randomUUID } from 'node:crypto';
import {
  CURRENT_STATE,
  DRAFT_REVIEW_STATUS,
  ELIGIBILITY,
  EVIDENCE_STATUS,
  EXECUTION_MODE,
  IMPACT_LEVEL,
  JURISDICTION_RELATION,
  MATERIAL_TYPE,
  PUBLICATION_AUTHORIZATION,
  RELEVANCE,
  SIGNAL_KIND,
  SliceBValidationError,
  UNCERTAINTY,
} from '../contracts/slice-b.mjs';
import { renderAssessmentText, renderTeamsDraft } from '../draft/renderer.mjs';

const HASH_RE = /^[a-f0-9]{64}$/;
const EVIDENCE_STATUSES = new Set(Object.values(EVIDENCE_STATUS));
const CURRENT_STATES = new Set(Object.values(CURRENT_STATE));
const MATERIAL_TYPES = new Set(Object.values(MATERIAL_TYPE));
const EXECUTION_MODES = new Set(Object.values(EXECUTION_MODE));
const JURISDICTION_RELATIONS = new Set(Object.values(JURISDICTION_RELATION));
const SIGNAL_KINDS = new Set(Object.values(SIGNAL_KIND));
const SOURCE_AUTHORITIES = new Set(['OFFICIAL_GOVERNMENT', 'OFFICIAL_LOCAL_GOVERNMENT', 'OFFICIAL_OTHER_PRIMARY']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validDate(value) {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateEvidence(evidence) {
  const required = [
    'EvidenceId', 'SourceAuthority', 'DocumentTitle', 'DocumentType', 'PublishedAt',
    'SourceUrl', 'CanonicalSourceUrl', 'ContentHash', 'RetrievedAt', 'Jurisdiction',
  ];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new SliceBValidationError('INVALID_EVIDENCE');
  }
  const issues = required.filter((key) => !nonEmptyString(evidence[key]));
  if (!Array.isArray(evidence.ApplicableServices) || evidence.ApplicableServices.some((v) => !nonEmptyString(v))) {
    issues.push('ApplicableServices');
  }
  if (!EVIDENCE_STATUSES.has(evidence.EvidenceStatus)) issues.push('EvidenceStatus');
  if (!SOURCE_AUTHORITIES.has(evidence.SourceAuthority)) issues.push('SourceAuthority');
  if (!HASH_RE.test(evidence.ContentHash ?? '')) issues.push('ContentHash');
  if (!validDate(evidence.PublishedAt) || !validDate(evidence.RetrievedAt)) issues.push('date');
  if (evidence.EffectiveAt !== undefined && evidence.EffectiveAt !== null && !validDate(evidence.EffectiveAt)) issues.push('EffectiveAt');
  if (issues.length) throw new SliceBValidationError('INVALID_EVIDENCE', issues);
}

function validateCurrentState(currentState, evidenceId) {
  if (!currentState || typeof currentState !== 'object' || Array.isArray(currentState)) {
    throw new SliceBValidationError('INVALID_CURRENT_STATE');
  }
  if (!nonEmptyString(currentState.EvidenceId) || !CURRENT_STATES.has(currentState.state)) {
    throw new SliceBValidationError('INVALID_CURRENT_STATE');
  }
  if (currentState.EvidenceId !== evidenceId) {
    throw new SliceBValidationError('CURRENT_STATE_ID_MISMATCH');
  }
}

function validateTargetContext(targetContext) {
  if (!targetContext || typeof targetContext !== 'object' || Array.isArray(targetContext)) {
    throw new SliceBValidationError('INVALID_TARGET_CONTEXT');
  }
  for (const key of ['targetServices', 'targetRoles', 'targetTopics']) {
    if (!Array.isArray(targetContext[key]) || targetContext[key].some((v) => !nonEmptyString(v))) {
      throw new SliceBValidationError('INVALID_TARGET_CONTEXT', [key]);
    }
  }
  if (!nonEmptyString(targetContext.jurisdiction) || !JURISDICTION_RELATIONS.has(targetContext.jurisdictionRelation)) {
    throw new SliceBValidationError('INVALID_TARGET_CONTEXT');
  }
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || !validDate(policy.assessmentAt)) {
    throw new SliceBValidationError('INVALID_ASSESSMENT_POLICY');
  }
  if (policy.urgentWithinDays !== undefined && (!Number.isInteger(policy.urgentWithinDays) || policy.urgentWithinDays < 0)) {
    throw new SliceBValidationError('INVALID_ASSESSMENT_POLICY', ['urgentWithinDays']);
  }
}

function validateExecutionMode(mode) {
  if (!EXECUTION_MODES.has(mode)) throw new SliceBValidationError('INVALID_EXECUTION_MODE');
}

function validateMaterialShape(material) {
  if (material === undefined || material === null) return;
  if (!material || typeof material !== 'object' || Array.isArray(material)) {
    throw new SliceBValidationError('INVALID_MATERIAL');
  }
  if (!nonEmptyString(material.EvidenceId) || !HASH_RE.test(material.EvidenceContentHash ?? '') ||
      !nonEmptyString(material.materialText) || !MATERIAL_TYPES.has(material.materialType)) {
    throw new SliceBValidationError('INVALID_MATERIAL');
  }
}

function validateSignals(signals, materialText = '') {
  if (!Array.isArray(signals)) throw new SliceBValidationError('INVALID_GROUNDED_SIGNAL');
  return signals.map((signal) => {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal) ||
        !SIGNAL_KINDS.has(signal.kind) || !nonEmptyString(signal.text) ||
        !Number.isInteger(signal.startOffset) || !Number.isInteger(signal.endOffset) ||
        signal.startOffset < 0 || signal.endOffset <= signal.startOffset || signal.endOffset > materialText.length ||
        materialText.slice(signal.startOffset, signal.endOffset) !== signal.text) {
      throw new SliceBValidationError('INVALID_GROUNDED_SIGNAL');
    }
    return Object.freeze({ ...signal });
  });
}

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function serviceIntersection(evidence, targetContext) {
  const targets = new Set(targetContext.targetServices);
  return evidence.ApplicableServices.filter((service) => targets.has(service));
}

function classifyRelevance(evidence, targetContext) {
  if (targetContext.jurisdictionRelation === JURISDICTION_RELATION.OUTSIDE) {
    return RELEVANCE.NOT_RELEVANT;
  }
  const intersects = serviceIntersection(evidence, targetContext).length > 0;
  if (targetContext.jurisdictionRelation === JURISDICTION_RELATION.MATCH && intersects) {
    return RELEVANCE.RELEVANT;
  }
  return RELEVANCE.POSSIBLY_RELEVANT;
}

function isCurrentStateConflict(evidence, currentState) {
  return (evidence.EvidenceStatus === EVIDENCE_STATUS.SUPERSEDED && currentState.state === CURRENT_STATE.CURRENT) ||
    (evidence.EvidenceStatus === EVIDENCE_STATUS.WITHDRAWN && currentState.state === CURRENT_STATE.CURRENT);
}

function dateUrgency(evidence, policy) {
  if (policy.urgentWithinDays === undefined || evidence.EffectiveAt === undefined || evidence.EffectiveAt === null) return false;
  const assessmentMs = Date.parse(policy.assessmentAt);
  const effectiveMs = Date.parse(evidence.EffectiveAt);
  const windowMs = policy.urgentWithinDays * 86_400_000;
  return assessmentMs <= effectiveMs && effectiveMs <= assessmentMs + windowMs;
}

function buildSourceFactSummary(signals) {
  const ordered = [...signals].sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  const seen = new Set();
  const texts = [];
  for (const signal of ordered) {
    const key = `${signal.startOffset}:${signal.endOffset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(signal.text);
  }
  return texts.join('\n');
}

function baseResult(evidence, targetContext, relevance, eligibility, uncertaintyFlags, impactId) {
  const relevantServices = relevance === RELEVANCE.RELEVANT ? serviceIntersection(evidence, targetContext) : [];
  return {
    ImpactId: impactId,
    EvidenceId: evidence.EvidenceId,
    eligibility,
    relevance,
    RelevantServices: Object.freeze([...relevantServices]),
    RelevantRoles: Object.freeze([]),
    ...(evidence.EffectiveAt ? { EffectiveAt: evidence.EffectiveAt } : {}),
    UncertaintyFlags: Object.freeze([...uncertaintyFlags]),
    DraftReviewStatus: DRAFT_REVIEW_STATUS,
    PublicationAuthorization: PUBLICATION_AUTHORIZATION,
  };
}

function reviewOnly(evidence, targetContext, relevance, flags, impactId) {
  return Object.freeze(baseResult(evidence, targetContext, relevance, ELIGIBILITY.REVIEW_ONLY, flags, impactId));
}

function notEligible(evidence, targetContext, relevance, flags, impactId) {
  return Object.freeze(baseResult(evidence, targetContext, relevance, ELIGIBILITY.NOT_ELIGIBLE, flags, impactId));
}

export function assessImpact(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SliceBValidationError('INVALID_INPUT');
  }
  const {
    evidence,
    material,
    currentState,
    targetContext,
    assessmentPolicy,
    groundedSignals = [],
    executionMode = EXECUTION_MODE.NORMAL,
  } = input;

  validateEvidence(evidence);
  validateCurrentState(currentState, evidence.EvidenceId);
  validateTargetContext(targetContext);
  validatePolicy(assessmentPolicy);
  validateExecutionMode(executionMode);
  validateMaterialShape(material);

  const idGenerator = options.idGenerator ?? randomUUID;
  const impactId = idGenerator();
  if (!nonEmptyString(impactId)) throw new TypeError('idGenerator must return non-empty string');

  const uncertainty = [];
  if (evidence.EvidenceStatus === EVIDENCE_STATUS.OFFICIAL_PENDING_REVIEW) uncertainty.push(UNCERTAINTY.EVIDENCE_NOT_VERIFIED);
  if (!evidence.EffectiveAt) uncertainty.push(UNCERTAINTY.EFFECTIVE_DATE_UNKNOWN);
  if (targetContext.jurisdictionRelation === JURISDICTION_RELATION.UNKNOWN) uncertainty.push(UNCERTAINTY.JURISDICTION_UNKNOWN);

  if (isCurrentStateConflict(evidence, currentState)) {
    uncertainty.push(UNCERTAINTY.CURRENT_STATE_CONFLICT);
    return reviewOnly(evidence, targetContext, RELEVANCE.UNKNOWN, uncertainty, impactId);
  }

  if (evidence.EvidenceStatus === EVIDENCE_STATUS.SUPERSEDED || evidence.EvidenceStatus === EVIDENCE_STATUS.WITHDRAWN ||
      currentState.state === CURRENT_STATE.SUPERSEDED || currentState.state === CURRENT_STATE.WITHDRAWN) {
    return notEligible(evidence, targetContext, RELEVANCE.NOT_RELEVANT, uncertainty, impactId);
  }

  if (currentState.state === CURRENT_STATE.UNRESOLVED) {
    uncertainty.push(UNCERTAINTY.SUPERSESSION_UNRESOLVED);
    return reviewOnly(evidence, targetContext, RELEVANCE.UNKNOWN, uncertainty, impactId);
  }

  const relevance = classifyRelevance(evidence, targetContext);
  if (relevance === RELEVANCE.NOT_RELEVANT) {
    return notEligible(evidence, targetContext, relevance, uncertainty, impactId);
  }
  if (relevance === RELEVANCE.POSSIBLY_RELEVANT) uncertainty.push(UNCERTAINTY.RELEVANCE_UNCERTAIN);

  if (!material) {
    uncertainty.push(UNCERTAINTY.MATERIAL_UNAVAILABLE);
    return reviewOnly(evidence, targetContext, relevance, uncertainty, impactId);
  }

  const idMismatch = material.EvidenceId !== evidence.EvidenceId;
  const declaredHashMismatch = material.EvidenceContentHash !== evidence.ContentHash;
  const fullTextHashMismatch = material.materialType === MATERIAL_TYPE.FULL_TEXT && sha256(material.materialText) !== evidence.ContentHash;
  if (idMismatch || declaredHashMismatch || fullTextHashMismatch) {
    uncertainty.push(UNCERTAINTY.MATERIAL_MISMATCH);
    return reviewOnly(evidence, targetContext, relevance, uncertainty, impactId);
  }

  if (material.materialType === MATERIAL_TYPE.SUPPLIED_EXCERPT ||
      (material.materialType === MATERIAL_TYPE.SYNTHETIC_FIXTURE && executionMode === EXECUTION_MODE.NORMAL)) {
    return reviewOnly(evidence, targetContext, relevance, uncertainty, impactId);
  }

  const signals = validateSignals(groundedSignals, material.materialText);
  if (signals.length === 0) {
    uncertainty.push(UNCERTAINTY.SOURCE_FACT_UNAVAILABLE);
    return reviewOnly(evidence, targetContext, relevance, uncertainty, impactId);
  }

  let impactLevel;
  if (relevance === RELEVANCE.POSSIBLY_RELEVANT) {
    impactLevel = IMPACT_LEVEL.CHECK;
  } else {
    const hasUrgencySignal = signals.some((s) => s.kind === SIGNAL_KIND.URGENCY);
    const hasActionSignal = signals.some((s) => s.kind === SIGNAL_KIND.OBLIGATION || s.kind === SIGNAL_KIND.CHANGE);
    if (hasUrgencySignal || dateUrgency(evidence, assessmentPolicy)) {
      impactLevel = IMPACT_LEVEL.URGENT_REVIEW;
    } else if (hasActionSignal) {
      impactLevel = IMPACT_LEVEL.ACTION_REQUIRED;
      uncertainty.push(UNCERTAINTY.OBLIGATION_UNCONFIRMED);
    } else {
      impactLevel = IMPACT_LEVEL.INFO;
    }
  }

  const sourceFactSummary = buildSourceFactSummary(signals);
  const { potentialImpact, suggestedCheck } = renderAssessmentText(impactLevel);
  const teamsDraft = renderTeamsDraft({ evidence, targetContext, impactLevel, sourceFactSummary, uncertaintyFlags: uncertainty });

  return Object.freeze({
    ...baseResult(evidence, targetContext, relevance, ELIGIBILITY.ELIGIBLE_INTERNAL_DRAFT, uncertainty, impactId),
    ImpactLevel: impactLevel,
    SourceFactSummary: sourceFactSummary,
    PotentialImpact: potentialImpact,
    SuggestedCheck: suggestedCheck,
    TeamsDraft: teamsDraft,
  });
}
