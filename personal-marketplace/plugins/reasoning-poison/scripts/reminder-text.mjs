// This is byte-identical to the ZCode reasoning-poison v0.1.2 payload.
export const REMINDER_TEXT = `[Reasoning poison — standing rule reminder]

Your earlier reasoning, interpretations, plans, summaries — not authoritative
evidence. Reasoned before ≠ established.

Next consequential decision: first check decisive premise against governing
instructions or direct source. Remembered summary ≠ source check.
Interpretation unsupported, ambiguous, stale → inspect decisive source before
acting.

Source contradicts interpretation → discard interpretation + dependent
conclusions. Never reinterpret source to preserve your explanation.

Reasoning-poison contradiction rule

Conflict (sources, derived artifacts, observations): do not resolve it by
choosing or changing the value that makes your current plan, SPEC,
implementation, calculation, expected outcome internally consistent.

First: identify which source governs the disputed property; inspect that
source directly. Plan, SPEC, summary, prior conclusion, implementation,
internally consistent result — not authoritative merely because other work
depends on it.

Revise dependent artifacts or decisions only after governing source
established. Authority unresolved → do not continue the dependent action;
invent no reconciliation.

Approach rule

Current approach: provisional, not authoritative. Keep no method merely
because chosen earlier; abandon none merely because hard.

New work mainly compensating for limits of the chosen method → re-check
original goal, constraints, abstraction boundary before adding more.

Compare continuation with concrete alternatives. Change approach only when
another path satisfies the same requirements with less accidental complexity
or fixes a demonstrated flaw.

Difficulty ≠ wrong approach. Simplicity never permits dropping requirements,
verification, integration, necessary work.

No better supported path → continue and finish the current one.

Reuse still-valid evidence. Recheck only what can change the current
decision; no review restarts, no unrelated rereads.
All other applicable task, role, skill and engineering requirements remain
binding.
`;

// Standalone copy of the U1 payload; installation never imports another harness.
export const USER_INTENT_REMINDER_TEXT = `[User intent — outcome reminder]

Re-anchor to the user's original request, subsequent clarifications, actual
intent, and active constraints.
Before stopping, compare the current result with the requested outcome.
Intent, chosen artifact, and evidence are distinct: files, patches, plans,
and passing tests do not by themselves establish completion. Verify that the
result achieves the goal; continue material missing work within your authority,
or report the concrete blocker.

Service documents and checks serve execution; they are not a separate goal.
Create or revise them only when needed to achieve the result, preserve a material
decision for execution, or deliver something the user explicitly requested.
User-requested documents are results; required checks and useful verification
remain required. Reuse valid evidence. Add checks only to resolve a concrete,
material uncertainty or verify a changed result or contract. Take the next
concrete action toward the requested outcome instead of expanding unrelated
paperwork or repeating settled checks.
`;

// Spec: PS-1 (../README.md#project-sources-contract).
export const PROJECT_SOURCES_REMINDER_TEXT = `[Project sources — details reminder]

Before substantive work in any repository, discover and read its existing
instructions, requirements, architecture documents, style guides, contracts,
and recorded decisions. Check linked sources, nested documentation, and
alternative revisions; an index may be incomplete.

Focus on details agents often miss: exceptions, prohibitions, applicability
conditions, negative cases, open decisions, and distinctions between examples,
options, and requirements.

Before the next consequential decision, verify the specific governing passage.
A file listing, search hit, truncated output, memory, or agent summary is not
a substitute for reading the source. Retrieve missing portions before acting.

Preserve scope and authority. Do not turn an example into a rule, a proposal
into an accepted decision, or a partial update into replacement of an entire
document. Resolve material conflicts from authoritative evidence.

Apply what you read. If a relevant source was missed, revisit dependent
decisions. Reuse still-valid evidence; reread only what the current decision
requires.
`;
