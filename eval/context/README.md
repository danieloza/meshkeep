# Evaluation sets for context

How well does MeshKeep find the files and the text a question needs? These sets measure it,
so a change to context is judged on numbers. The design they were built for is
[`docs/adr/0001-context-and-citations.md`](../../docs/adr/0001-context-and-citations.md).

## What is here

```
schema.ts            the format of a set and of its results (zod)
measure.ts           how results are counted, shared by the runner and the simulation
chunking.ts          the chunking rule the simulation uses
.gitattributes       keeps the bytes of a corpus the same on every machine
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
npx vitest run tests/eval-context.test.ts tests/eval-context-rules.test.ts
```

The first file checks every set: each quote is in the text MeshKeep's extractors produce from
its file, each page, sheet or heading given for a quote holds it, each "forbidden" file is
closed to the person asking, and the text files of the corpus have LF line endings. The second
tests the counting and chunking rules themselves.

```bash
npm run eval:context -- dev
```

Measures the set through the HTTP API of a local build and writes `baseline.json`. It builds
the application when needed and takes several minutes: the chat allows ten messages a minute
per person, and the run keeps under that. Any request that fails stops the run. Windows only,
like the API tests it shares its harness with.

```bash
node --experimental-strip-types scripts/eval-context-chunks.mjs dev
```

Simulates other ways of choosing context on the same questions and writes `simulation.json`.
Needs Node 24.

Both commands give the same file on every run and on every checkout of the same commit.

## Reading a result

For each expected source of a question:

- **found**: its file was among the files suggested for the question;
- **delivered**: its quote was in the text that this file itself contributed to what the
  model provider received. The same words arriving from another file do not count. The
  comparison collapses whitespace first, so it is containment, not a byte-for-byte quotation.

The simulation also reports **passageDelivered** for each source and scored question. It
requires the quote in an actually selected source slice, at the expected page, sheet or heading
when specified. A generated label can contain the words the model receives, but cannot by
itself prove a source passage was selected. `deliveredWithoutPassage` lists questions where
delivery passed and this stricter check did not; it can include a locator mismatch as well as
label-only matches. Whole files are checked against their extracted text and location.

A share always stands next to its count. With five questions of a kind, one question is twenty
percentage points.

**Context size** is the length, in characters, of the message that carries the files to the
provider, as the chat writes it. Two means are given: over every question of a group, where a
question that sent nothing counts as zero, and over the questions that sent something. Compare
like with like.

The files-then-passages simulation enforces each long file's allowance on its serialized
passages (including labels, restored gaps and omission marks), and the total allowance on the
entire file-context message (including the preamble, file headings and section rules).

**`no-answer` questions are not scored.** What was suggested and sent for them is reported;
whether a model then says "the documents do not say" is not something these sets measure.

**`access` questions are counted per forbidden file.** Each file has its own search phrase.
A file is *refused* when the phrase finds it for the owner of its project, does not find it
for the person asking, and its project answers 404 to them. It is *inconclusive* when the
owner's search does not find it either, because then the asker's empty result proves nothing.

## What a set does not measure

- Answers. No model is called.
- What a reader finds. Every asker can send a chat message in the project they ask in, which
  takes edit access. Search by someone who can only read is covered by the API tests, not here.
- Other teams' documents. The development set was written by the same agent as the design.

## Adding a set

A set is a directory under `sets/` with the same files. The holdout set is to be built by a
different agent than the development set, with its own corpus, and without tuning anything on
it: the development set is where a design is worked out, the holdout set is where it is
checked.
