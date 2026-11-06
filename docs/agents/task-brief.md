# Task brief

The lead writes one of these before any agent starts. Copy it, fill it in, and
keep it next to the work: in the pull request description for public work, or in
the owner's private workspace when it names the hosted instance or its data.

```markdown
# Brief: <short name>

Builder: <agent>        Reviewer: <a different agent>        Branch: <name>

## Goal
What the owner gets when this is done, in one or two sentences.

## Contract
What other work depends on and must not change without the lead:
- API shapes (the zod contract in `lib/contracts/...`), table columns, file formats;
- for data handed between agents: the exact format and an example.

## Files owned
The only files and directories this task may change.

## Acceptance criteria
Each one is a check that can be run, with the result that counts as a pass:
1. `<command>` → <expected result>
2. ...
Plus the standard checks in AGENTS.md.

## Out of scope
What this task does not do, so nobody does it on the way.

## Gates
Which steps need the owner's approval here (push, PR, merge, deploy, secrets).

## Report
What the builder hands back: the changes, each criterion with its evidence
(command and output), and what was not checked.
```

## Why each part is there

- **Contract before work.** Agents that work at the same time only stay out of
  each other's way if the shapes between their work are fixed first. Otherwise
  each guesses the other's format, and two of them redo it.
- **Acceptance criteria before work.** Written afterwards, criteria describe what
  was built rather than what was needed.
- **Files owned.** Two agents editing the same file is the most common way
  parallel work goes wrong.
