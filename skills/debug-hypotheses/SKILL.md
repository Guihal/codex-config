---
name: debug-hypotheses
description: >
  Use before proposing or applying a bug fix, especially when one obvious cause
  dominates, a prior fix failed, the error seems impossible, or time pressure
  encourages guess-and-check. Requires at least eight competing hypotheses and
  cheap discriminating evidence before edits.
---

# Debug hypotheses — storm wide before fixing

## Iron rule

No fix, edit, or speculative trial before the hypothesis table exists.

## 1. Storm at least eight hypotheses

Include at least one from each relevant category: logic; data; state/timing;
integration; environment; resources; build/cache; recent change; wrong report
or multiple bugs; wrong mental model. Include at least two ideas a developer
would not consider first and at least one explicit assumption that may be wrong.

## 2. Rank by cost to test

For every hypothesis write:

```text
H# | one-line claim | cheapest discriminating test
```

Sort by test cost, not perceived likelihood. A discriminating test has
different outcomes depending on whether the hypothesis is true.

## 3. Discriminate

Run the cheapest read/search/log/command evidence first. Tag temporary
instrumentation with its hypothesis, for example `[H3]`. Give each hypothesis
one verdict: confirmed, falsified, or inconclusive. Absence of evidence is not
falsification. One observation may test several hypotheses.

## 4. Fix only a confirmed cause

Apply the smallest correction, verify the original bug is gone rather than only
that code compiles, and remove temporary instrumentation. If every hypothesis
is falsified, storm again more broadly; never patch the least-falsified guess.

Stop and restart the storm when you catch: "probably X", editing before a
verdict, testing only the favorite theory, or stacking fix 2 on failed fix 1.
