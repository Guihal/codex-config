---
name: brief-person
description: One-off first-run briefing that records who the operator is and calibrates the agent's responsibility level, question count and explanation language. Use ONLY on a fresh install, when `~/.codex/PERSON.md` is missing or has no collected date. Never run it when a collected profile exists. After writing the profile and rewriting the AGENTS.md profile block, the skill deletes its own directory.
---

# Brief the person

One purpose: learn enough about the operator to calibrate three things — how much responsibility the
agent takes, how often it asks, and how plainly it explains. `docs/brief.md` in the archive explains
the same thing to humans.

## Runs once, then removes itself

This skill executes **exactly once per installation**.

- Before starting, check `~/.codex/PERSON.md`. If it exists and contains a `collected:` date, do not
  run the briefing: say that the profile is already recorded and that the file itself can be edited.
- After the profile is written, delete the skill directory (see "Delete yourself").
- A later re-run is only possible if the person explicitly restores the skill; do not recreate it
  on your own.

## Order of questions

Ask in this order, at most four questions per message, and stop as soon as the picture is clear.
Never ask something the current session already answered.

1. **Name and handle.** How to address them, and what to call the work ("ты"/"вы" preference).
2. **Role.** What they actually do: designer, frontend, fullstack, backend, product, other. Ask for the
   role they think in, not their job title.
3. **Level, per area.** For each area that matters to their role, ask them to pick one:
   *новичок* (needs terms unpacked), *уверенный* (knows the field, wants the decision and its reason),
   *эксперт* (wants conclusions and evidence, and takes the professional calls themselves). Areas:
   layout/CSS, JavaScript/TypeScript, Figma, Tilda, tooling/CLI, backend. Skip areas their role never
   touches.
4. **Language.** Which language to answer in, and whether internal artifacts (plans, notes) may use
   English.
5. **Projects folder — mandatory.** Ask two things in one message: what they usually build, and the
   **absolute path to the folder where project folders live**. That path is required data, not small
   talk: it is stored as `projects_root`, and the `basa-project` skill rewrites its own header with
   it so cloning never asks again. If the person declines, record `declined` and say plainly that the
   first project checkout will have to ask for the path.
6. **Depth.** Short and dense, or explanatory with reasoning? Do they want the recommendation first?

## What the answers change

The level is not just a style dial — it sets **how much the agent takes on itself**:

| Level | Responsibility | Questions |
| --- | --- | --- |
| новичок | proposes the path and confirms each step before doing it | frequent: every non-obvious choice |
| уверенный | does ordinary work itself, states what it did | only real forks and irreversible steps |
| эксперт | takes the professional decisions in their area and reports afterwards | only irreversible actions, product-scope choices, or missing facts |

Explanation language follows the same axis: the lower the level, the plainer the wording — fewer
terms, shorter sentences, "what happened / what I did / what's next". Higher levels get the decision,
the reason and the rejected alternative instead of teaching.

What the level never changes: whether an unverified result is reported as verified, and whether an
irreversible action is taken without consent. Those stay fixed for everyone.

## Output

Write `~/.codex/PERSON.md`:

```md
# Person

- name: <…>
- address: <ты|вы>
- role: <…>
- level: layout=<…> js=<…> figma=<…> tilda=<…> tooling=<…> backend=<…>
- language: answers=<…> artifacts=<…>
- projects: <what they usually build>
- projects_root: <absolute path | declined>
- depth: <short|explanatory>; recommendation-first: <yes|no>
- communication: language=<…> tone=<…> format=<…> questions=<…>
- collected: <YYYY-MM-DD>
```

Then rewrite only the block between `<!-- profile:start -->` and `<!-- profile:end -->` in
`~/.codex/AGENTS.md`, keeping the same keys. If the markers are absent, append the block. Never
rewrite the rest of `AGENTS.md`.

## When `projects_root` was answered

Write the path into `~/.codex/skills/basa-project/SKILL.md`: replace the line that starts with
`projects_root:` with `projects_root: <path>`. That file is the skill's own memory of where projects
belong; from then on the skill never asks and always creates `<projects_root>/<project name>`.

## After the brief: study the communication, then change the rule

Mandatory, not optional. Once the profile is written, the agent studies how the person actually talks
to it — a subagent, not the main session — and then rewrites at least the communication rule. That
rule lives in **inject-rules**, not in `AGENTS.md`:

`~/.codex/standing-rules/84-communication-profile.json`

1. Spawn one subagent (`task`, background) and give it: the whole brief exchange verbatim, the
   person's messages in this session, and `~/.codex/PERSON.md`. Nothing else is needed.
2. Ask it for: how the person phrases requests (imperatives, streams of thought, corrections,
   profanity, lists), what they react badly to, how long answers should be, whether tables and
   bullets help or annoy, whether they want conclusions first, how many terms they tolerate, and
   5–7 concrete communication rules written as instructions to the agent.
3. Rewrite the rule file: its `body` (the six lines `language`, `tone`, `format`, `terms`,
   `questions`, `reports`) and its `remind.suffix`. Flip the body marker from
   `<!-- profile:default -->` to `<!-- profile:rewritten -->`. At minimum `language` and `tone`
   change to match the person; more if the evidence supports it. Keep the file valid JSON — writing
   it through a JSON encoder, never by hand-editing escaped strings.
4. Fill the `communication:` line in `PERSON.md` with the same values.
5. Do not touch the other rule files: `01-*`, `17-*`, `70-*` and the rest come from their own
   source and a local edit would disappear on the next regeneration. Rule `84` is the designated
   editable one.
6. Report which rules changed, and what the person will feel differently in the next answer.

If no subagent mechanism is available, say so plainly and do the analysis in the main session —
the requirement is the changed rule, the subagent is the means.

## Delete yourself

After `PERSON.md` and the `AGENTS.md` profile block are written and read back:

```sh
rm -rf ~/.codex/skills/brief-person
```

Say in the report that the profile is recorded, where, and that the briefing skill removed itself so
it cannot run twice. Delete nothing else — not `PERSON.md`, not other skills.

## Rules

- One briefing per installation; there is no second profile.
- Never store credentials, client secrets or personal data beyond the fields above.
- If the person declines to answer, write `declined` for that key and treat that area as *уверенный*
  for responsibility purposes.
- Do not invent levels: an unanswered area stays `declined`.
- Report in one short message: what was recorded, the responsibility level that follows from it, and
  one concrete behaviour change.
