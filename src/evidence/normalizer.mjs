import { createHash, randomUUID } from 'node:crypto';

export const EVIDENCE_STATUS = Object.freeze({
  OFFICIAL_PENDING_REVIEW: 'OFFICIAL_PENDING_REVIEW',
});

export const COMPARISON = Object.freeze({
  NEW: 'NEW',
  SAME_CONTENT: 'SAME_CONTENT',
  CONTENT_CHANGED: 'CONTENT_CHANGED',
  IDENTITY_UNRESOLVED: 'IDENTITY_UNRESOLVED',
});

const REQUIRED_STRING_FIELDS = Object.freeze([
  'sourceUrl',
  'sourceAuthority',
  'documentTitle',
  'documentType',
  'publishedAt',
  'retrievedAt',
  'rawContent',
  'jurisdiction',
]);

export class EvidenceValidationError extends Error {
  constructor(issues) {
    super('Evidence input validation failed');
    this.name = 'EvidenceValidationError';
    this.code = 'EVIDENCE_VALIDATION_ERROR';
    this.issues = Object.freeze([...issues]);
  }
}

export function computeContentHash(rawContent) {
  if (typeof rawContent !== 'string') {
    throw new EvidenceValidationError(['rawContent must be a string']);
  }

  return createHash('sha256').update(Buffer.from(rawContent, 'utf8')).digest('hex');
}

function validateUrl(value, fieldName, issues) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      issues.push(`${fieldName} must use http or https`);
    }
    if (parsed.username || parsed.password) {
      issues.push(`${fieldName} must not contain embedded credentials`);
    }
  } catch {
    issues.push(`${fieldName} must be a valid URL`);
  }
}

function validateDateTime(value, fieldName, issues) {
  if (Number.isNaN(Date.parse(value))) {
    issues.push(`${fieldName} must be a valid date/time string`);
  }
}

export function validateAuthoritativeInput(input) {
  const issues = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new EvidenceValidationError(['input must be an object']);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      issues.push(`${field} is required and must be a non-empty string`);
    }
  }

  if (!Array.isArray(input.applicableServices)) {
    issues.push('applicableServices is required and must be an array');
  } else if (input.applicableServices.some((value) => typeof value !== 'string')) {
    issues.push('applicableServices must contain strings only');
  }

  if (typeof input.sourceUrl === 'string' && input.sourceUrl.length > 0) {
    validateUrl(input.sourceUrl, 'sourceUrl', issues);
  }

  if (input.canonicalSourceUrl !== undefined) {
    if (typeof input.canonicalSourceUrl !== 'string' || input.canonicalSourceUrl.length === 0) {
      issues.push('canonicalSourceUrl must be a non-empty string when supplied');
    } else {
      validateUrl(input.canonicalSourceUrl, 'canonicalSourceUrl', issues);
    }
  }

  for (const field of ['publishedAt', 'retrievedAt']) {
    if (typeof input[field] === 'string' && input[field].length > 0) {
      validateDateTime(input[field], field, issues);
    }
  }

  if (input.effectiveAt !== undefined && input.effectiveAt !== null) {
    if (typeof input.effectiveAt !== 'string' || input.effectiveAt.length === 0) {
      issues.push('effectiveAt must be a non-empty date/time string when supplied');
    } else {
      validateDateTime(input.effectiveAt, 'effectiveAt', issues);
    }
  }

  for (const field of ['sourceDocumentId', 'sourceVersion', 'supersedesEvidenceId']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length === 0)) {
      issues.push(`${field} must be a non-empty string when supplied`);
    }
  }

  if (issues.length > 0) {
    throw new EvidenceValidationError(issues);
  }
}

function normalizedIdentityFields(record) {
  return {
    sourceAuthority: record.SourceAuthority ?? record.sourceAuthority,
    jurisdiction: record.Jurisdiction ?? record.jurisdiction,
    sourceDocumentId: record.SourceDocumentId ?? record.sourceDocumentId,
    canonicalSourceUrl: record.CanonicalSourceUrl ?? record.canonicalSourceUrl ?? record.SourceUrl ?? record.sourceUrl,
  };
}

export function resolveSourceIdentity(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const fields = normalizedIdentityFields(record);

  if (typeof fields.sourceDocumentId === 'string' && fields.sourceDocumentId.length > 0) {
    if (
      typeof fields.sourceAuthority !== 'string' ||
      fields.sourceAuthority.length === 0 ||
      typeof fields.jurisdiction !== 'string' ||
      fields.jurisdiction.length === 0
    ) {
      return null;
    }

    return `document:${fields.sourceAuthority}:${fields.jurisdiction}:${fields.sourceDocumentId}`;
  }

  if (typeof fields.canonicalSourceUrl === 'string' && fields.canonicalSourceUrl.length > 0) {
    return `url:${fields.canonicalSourceUrl}`;
  }

  return null;
}

function compareEvidence(evidence, priorEvidence) {
  if (priorEvidence === undefined || priorEvidence === null) {
    return COMPARISON.NEW;
  }

  const currentIdentity = resolveSourceIdentity(evidence);
  const priorIdentity = resolveSourceIdentity(priorEvidence);

  if (currentIdentity === null || priorIdentity === null) {
    return COMPARISON.IDENTITY_UNRESOLVED;
  }

  if (currentIdentity !== priorIdentity) {
    return COMPARISON.NEW;
  }

  if (typeof priorEvidence.ContentHash !== 'string') {
    return COMPARISON.IDENTITY_UNRESOLVED;
  }

  return priorEvidence.ContentHash === evidence.ContentHash
    ? COMPARISON.SAME_CONTENT
    : COMPARISON.CONTENT_CHANGED;
}

export function normalizeEvidence(input, options = {}) {
  validateAuthoritativeInput(input);

  const idGenerator = options.idGenerator ?? randomUUID;
  if (typeof idGenerator !== 'function') {
    throw new TypeError('idGenerator must be a function');
  }

  const generatedId = idGenerator();
  if (typeof generatedId !== 'string' || generatedId.length === 0) {
    throw new TypeError('idGenerator must return a non-empty string');
  }

  const evidence = Object.freeze({
    EvidenceId: generatedId,
    SourceAuthority: input.sourceAuthority,
    DocumentTitle: input.documentTitle,
    DocumentType: input.documentType,
    PublishedAt: input.publishedAt,
    ...(input.effectiveAt !== undefined && input.effectiveAt !== null
      ? { EffectiveAt: input.effectiveAt }
      : {}),
    SourceUrl: input.sourceUrl,
    CanonicalSourceUrl: input.canonicalSourceUrl ?? input.sourceUrl,
    ...(input.sourceDocumentId !== undefined ? { SourceDocumentId: input.sourceDocumentId } : {}),
    ...(input.sourceVersion !== undefined ? { SourceVersion: input.sourceVersion } : {}),
    ContentHash: computeContentHash(input.rawContent),
    RetrievedAt: input.retrievedAt,
    ApplicableServices: Object.freeze([...input.applicableServices]),
    EvidenceStatus: EVIDENCE_STATUS.OFFICIAL_PENDING_REVIEW,
    ...(input.supersedesEvidenceId !== undefined
      ? { SupersedesEvidenceId: input.supersedesEvidenceId }
      : {}),
    Jurisdiction: input.jurisdiction,
  });

  const comparison = compareEvidence(evidence, options.priorEvidence);
  const priorEvidenceId = options.priorEvidence?.EvidenceId;

  return Object.freeze({
    evidence,
    comparison,
    ...(typeof priorEvidenceId === 'string' && priorEvidenceId.length > 0
      ? { priorEvidenceId }
      : {}),
  });
}
