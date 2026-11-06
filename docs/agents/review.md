# Cross-review

The reviewer is never the agent that built the change. The question is not "is
this good?": an author's reasoning usually reads as sound, even when it rests on
something false. The reviewer's job is to find what might be false and check it
against something other than the author's word.

## 1. Three claims that might not be true

Read the pull request, its brief and its report. Pick **at least three claims**
the change depends on, preferring the ones you could not easily check, and
check each one against evidence the author did not produce:

- the code itself, or a test you run or write;
- the hosted instance or its backup, for claims about production;
- the documentation of a library or platform, for claims about how it behaves.

For each claim write: the claim, how you checked it, what you found, and whether
it holds.

## 2. Checklist

- [ ] **Contract.** Do the changed shapes match the brief? Does anything that
      depends on them still work?
- [ ] **Tests.** Do the new tests fail without the change? (Revert the fix
      locally and run them, or explain why they would fail.)
- [ ] **Acceptance criteria.** Rerun them. Does each one pass for you?
- [ ] **Access.** Can a member reach another member's private data? Can a
      non-owner do an owner's action? Does an error leak more than it should?
- [ ] **Untrusted input.** Is anything from a page, a file, a header or a model
      answer used as an instruction, as HTML, or in SQL without a guard?
- [ ] **Secrets.** No keys, tokens, real addresses or private hostnames in code,
      tests, logs or the description.
- [ ] **Data.** Migrations only add; nothing deletes or rewrites existing data
      without a copy.
- [ ] **What the person sees.** Text and errors say what happened and what to do.

## 3. Report

```markdown
# Review: <pull request>

Reviewer: <agent>     Author: <agent>     Commit reviewed: <sha>

## Claims checked
1. <claim> — <how checked> — <what was found> — holds / does not hold
2. ...
3. ...

## Checklist
<each item: ok, or the problem>

## Findings
<each with severity: blocker / should fix / note>

## Verdict
approve / changes requested
```

A review names the commit it looked at. A later commit needs a new look at
what changed since.
