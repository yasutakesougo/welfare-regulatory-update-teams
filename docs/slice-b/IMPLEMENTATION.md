# Slice B implementation

Scope basis: Issue #16 plus Scope Correction-1, Correction-2, and Correction-3.

This implementation is deterministic and external-write-free. It consumes Evidence as read-only input and requires explicit EvidenceMaterial, EvidenceCurrentState, TargetContext, AssessmentPolicy, and span-bound GroundedSourceSignal input.

## Safety invariants

- No live regulatory fetch, Teams API, Graph API, SharePoint, M365, credential loader, LLM, embedding, or network AI dependency.
- FULL_TEXT grounding is bound to Evidence.ContentHash by exact UTF-8 SHA-256.
- SUPPLIED_EXCERPT is REVIEW_ONLY and cannot produce a normal TeamsDraft.
- SYNTHETIC_FIXTURE is accepted only with explicit SYNTHETIC_ACCEPTANCE execution mode.
- Every normal TeamsDraft requires at least one validated source span.
- SourceFactSummary and changeSummary contain exact grounded text only.
- DraftReviewStatus is always NOT_REVIEWED.
- PublicationAuthorization is always NOT_AUTHORIZED.
- ACTION_REQUIRED is a triage label and carries OBLIGATION_UNCONFIRMED when derived from caller-supplied signal kind metadata.
- Exact service string intersection can establish relevance, but an empty intersection does not automatically suppress a notice.

## Verification

Run:

```text
npm test
```

Slice B tests cover material binding, current-state handling, relevance, urgency windows, wording safety, authority-state invariants, synthetic-mode isolation, zero-signal fail-closed behavior, input immutability, and public-repository safety.
