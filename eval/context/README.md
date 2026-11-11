# Evaluation sets for context

How well does MeshKeep find the files and the text a question needs? These sets measure it,
so a change to context is judged on numbers. The design they were built for is
[`docs/adr/0001-context-and-citations.md`](../../docs/adr/0001-context-and-citations.md).

## What is here

```
schema.ts            the format of a set and of its results (zod)
sets/
  dev/               the development set
    team.json        the people
    projects.json    their projects, visibility and sharing
    corpus/          the files, one directory per project
    sources/         HTML the PDFs are printed from
    build-corpus.mjs rebuilds the generated files of the corpus
    questions.json   the questions and what each should find
    baseline.json    measured through the application
    simulation.json  a what-if, not the application
```

Everything in a corpus is made up. No set may hold real documents, names or addresses.

## Commands

```bash
npx vitest run tests/eval-context.test.ts
```

Checks every set: each quote is in the text MeshKeep's extractors produce from its file, each
page, sheet or heading given for a quote holds it, each "forbidden" file is closed to the
person asking.

```bash
npm run eval:context -- dev
```

Measures the set through the HTTP API of a local build and writes `baseline.json`. It builds
the application when needed and takes a few minutes: the chat allows ten messages a minute per
person, and the run keeps under that. Windows only, like the API tests it shares its harness
with.

```bash
node --experimental-strip-types scripts/eval-context-chunks.mjs dev
```

Simulates other ways of choosing context on the same questions and writes `simulation.json`.
Needs Node 24.

## Reading a result

For each expected source of a question:

- **found**: its file was among the files suggested for the question;
- **delivered**: its quote was in the text the model provider received.

A share always stands next to its count. With five questions of a kind, one question is twenty
percentage points.

`no-answer` questions are not scored: what was suggested for them is reported, and whether a
model then says "the documents do not say" is not something these sets measure. `access`
questions count as refused only when the same search phrase finds the forbidden file for its
owner and not for the person asking.

## Adding a set

A set is a directory under `sets/` with the same files. The holdout set is to be built by a
different agent than the development set, with its own corpus, and without tuning anything on
it: the development set is where a design is worked out, the holdout set is where it is
checked.

An asker has to be able to send a chat message in the project they ask in: its owner, or
someone it is shared with as an editor.
