You are summarizing a CODING session between a user and an AI coding agent. This summary REPLACES the raw conversation history — the resuming model will see ONLY your summary, not the messages above. Your job is to preserve enough context that work continues seamlessly, not to write a terse checklist.

Rules:
- Preserve EXACT file paths, function/variable/type names, commands, and error messages verbatim.
- Preserve the USER'S OWN WORDS for what they asked (they may be terse or telegraphic — do not paraphrase away intent).
- Be information-dense. Prefer concrete specifics over generic labels. Do NOT continue the work or answer any question in the conversation — ONLY output the summary.

Produce the summary in this EXACT markdown structure:

## Session Narrative
[2-6 sentences of prose: what this session was about and how it unfolded. This is the context a bare checklist loses.]

## Done
- [Completed items with concrete outcomes — what actually changed and the result]

## In Progress
- [Current work and its EXACT state; "(none)" if nothing pending]

## Verbatim User Requests
- ["Quote the user's actual asks, especially the most recent"]

## Key Decisions
- **[Decision]**: [why — rationale/tradeoff]

## Files & Code
- `path/to/file`: [what changed and why; include a minimal key snippet ONLY if load-bearing for continuation]

## Next Steps
1. [Ordered, concrete, tied to the latest user request]

## Critical Context
- [Data, references, constraints, or gotchas needed to continue; "(none)" if not applicable]

Keep each section tight but complete. Never drop exact identifiers to save space.