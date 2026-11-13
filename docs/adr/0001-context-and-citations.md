# ADR 0001: Context and citations

- **Status:** proposed. Nothing in the product has changed; the owner decides.
- **Date:** 2026-11-11
- **Code described:** `main` at `4ff9e1f`
- **Evidence:** `eval/context/sets/dev/baseline.json` (measured through the application) and `eval/context/sets/dev/simulation.json` (a what-if, not the application)

## Summary

MeshKeep's Auto context picks whole files and fills a fixed budget with them in order. On the
development set it suggests every file a question needs for 37 of 40 questions, and that
part works well for Polish. But the text that answers the question reaches the model for
only 32 of 40. One long file is enough to cause the difference: it takes the whole budget,
its own answer is cut off, and the files ranked below it are not sent at all.

The decisions below keep what works and change what does not:

| # | Decision |
|---|---|
| 0 | Choose context in two steps: files as today, then from each file either all of it, when it is short, or its best passages. |
| 1 | Chunks follow the structure of the file (page, sheet, section) and are joined up to about 1 500 characters. A chunk is addressed by its file and position, and stamped with a key derived from the file's content hash. |
| 2 | Chunks live in a new D1 table with its own FTS5 index, added by a migration that only creates. `file_texts` stays. |
| 3 | One extraction feeds both the search index and the chat, and keeps page and section boundaries. |
| 4 | The budget is counted per model in tokens, on the server, which also reads the conversation history itself. |
| 5 | The model cites passages by short numbers. The server keeps only citations to passages it sent, and no text of a passage with the answer. |
| 6 | Passages are chosen inside the query, in the project of the message, as files are today. |
| 7 | Each answer records which passages went to which connection. |
| 8 | No vector search now. It gets considered when a named threshold on the evaluation sets is missed. |

A simulation of decision 0 on the same questions delivers the answer for 37 of 40, with 6 131
characters of context on average instead of 25 588. The three it still misses are the three
where the question and the file are in different languages.

---

## 1. Where MeshKeep stands

Checked in the code at `4ff9e1f`.

**Upload and index.** A file becomes a row in `files` with the SHA-256 of its bytes
(`db/schema.ts:134`) and an object in R2. Plain text is indexed at upload; documents are read
later, five per round (`lib/server/search-index.ts:14`, `:68`). The index is one row per file
in `file_texts`, holding at most the first 100 000 characters (`search-index.ts:11`), with an
FTS5 table over path and content (`drizzle/0003_search_index.sql:28`). Uploading a path again
deletes the old row and inserts a new one with a new ID
(`app/api/projects/[id]/files/route.ts:117`–`129`).

**Extraction.** PDF pages are merged into one text, so page boundaries are lost
(`lib/server/pdf-text.ts:28`). The whole document is extracted, however long, and the text is
then cut at 120 000 characters (`:22`, `:48`). The limit of 40 pages (`:21`) does not stop
the reading: a document with more pages only gets a note saying that text from the beginning
was added (`:49`–`50`).
A spreadsheet comes out as `# sheetN.xml` sections of tab-separated rows; the sheet's name is
not kept (`lib/document-text.ts`).

**Auto context.** While a question is typed, `suggest-files` checks read access to the open
project (`app/api/projects/[id]/suggest-files/route.ts:18`), turns the question into at most
12 stemmed prefix terms joined with OR (`lib/search.ts:14`, `:37`, `:61`), and returns the
five best files of that project by `bm25`, with the path weighted four times the content
(`route.ts:10`, `:29`). In Auto mode those files join the message
(`lib/context-mode.ts:14`).

**Chat.** The chat needs edit access to the project (`app/api/chat/route.ts:93`), so a reader
can search but cannot ask. It reads every attached file from R2 and extracts it again
(`route.ts:49`), then fills 80 000 characters with whole files in the order given
(`route.ts:16`, `:25`). A file that does not fit entirely is cut; the ones after it are not
sent. Each answer stores what happened to each file: `included`, `truncated`, `unreadable` or
`skipped` (`lib/contracts/conversations.ts:34`). The browser sends the last 20 messages as
history and asks for at most 2 048 answer tokens (`features/chat/chat-workspace.tsx:353`).
Tokens are estimated as characters divided by four (`lib/chat-stream.ts:112`). A member may
send ten messages a minute (`lib/server/chat-runs.ts:23`).

**Access.** One rule decides who reads a project (`lib/server/access.ts:21`); a project a
member cannot read answers 404 (`:45`). Search across projects applies the rule inside its SQL
(`app/api/search/route.ts:34`).

---

## 2. What was measured

### 2.1 The development set

`eval/context/sets/dev/`: a made-up studio of four people with five projects: two private,
two shared with named people, one open to the whole team. 38 files: Markdown, plain text, three PDFs with text on several
pages, one scanned PDF with no text, four DOCX, five XLSX, and one Markdown file of 116 578
characters. 37 of the 38 files are shorter than 6 000 characters; the median is 855.

54 questions, 31 in Polish and 23 in English:

| Kind | n | What it asks |
|---|---|---|
| `answerable` | 32 | The answer is in one file. |
| `multi-file` | 8 | The answer needs two files. |
| `no-answer` | 7 | The files the application can read do not hold the answer. |
| `access` | 7 | The answer exists, but only in a project the asker cannot open. |

Every expected source carries a quote. `tests/eval-context.test.ts` checks that each quote is
in the text MeshKeep's own extractors produce, that each PDF page number holds its quote when
that page is extracted alone, and that each forbidden file is closed to the asker.

### 2.2 The method

`npm run eval:context -- dev` runs a local build and goes through its HTTP API as the people
of the set. It uploads the corpus through the upload route, runs the indexing rounds, and for
each question calls `suggest-files` as the asker. It then sends a chat message with the
suggested files, as Auto mode does, to a model provider inside the script that only records
what it receives.

Two results per expected source:

- **found:** its file was among the suggestions;
- **delivered:** the chat reported the file as sent, and its quote was in the part of the
  message that came from that file. The same words arriving from another file do not count.
  The comparison collapses whitespace first, so it is containment and not a byte-for-byte
  quotation.

Context size is the length in characters of the message that carries the files to the
provider. Where a mean is given, it says over which questions.

For `access` questions every forbidden file has its own control. The script asks
`suggest-files` on the file's project as the asker, and searches all projects for a phrase
from that file, once as the asker and once as the owner of the file's project. A file counts
as refused only when the phrase finds it for its owner, does not find it for the asker, and
the project answers 404. When the owner's search does not find it either, the result is
inconclusive.

A request that fails stops the run, so a failure is never counted as a miss. The counting
rules are in `eval/context/measure.ts` and have their own tests
(`tests/eval-context-rules.test.ts`).

Two runs produced the same file, byte for byte. The corpus is pinned to the bytes that are
committed (`eval/context/.gitattributes`), so a checkout with CRLF conversion measures the
same files.

### 2.3 The baseline

Shares are followed by their counts. `n` is small everywhere: with five questions, one
question is twenty percentage points.

| Questions | n | Every file found | Every quote delivered |
|---|---|---|---|
| All scored | 40 | 93% (37) | 80% (32) |
| `answerable` | 32 | 91% (29) | 81% (26) |
| `multi-file` | 8 | 100% (8) | 75% (6) |
| Polish | 23 | 91% (21) | 91% (21) |
| English | 17 | 94% (16) | 65% (11) |

| Tag | n | Found | Delivered |
|---|---|---|---|
| no tag | 12 | 100% (12) | 92% (11) |
| `inflection` | 6 | 100% (6) | 100% (6) |
| `diacritics` | 3 | 100% (3) | 100% (3) |
| `synonym` | 3 | 100% (3) | 100% (3) |
| `exact` | 3 | 100% (3) | 100% (3) |
| `table` | 8 | 100% (8) | 88% (7) |
| `cross-language` | 5 | 40% (2) | 40% (2) |
| `deep` | 3 | 100% (3) | 0% (0) |

Context: all 40 scored questions sent a message, 25 588 characters on average and 80 626 at
most. Of the 162 files those messages carried, 127 were sent whole, 11 were cut, 22 were not
sent for lack of room, and 2 had no text.

`no-answer` (n = 7, not scored): 5 questions were still given five files each. Their messages
averaged 20 924 characters; counting the two questions that sent nothing as zero, the mean
over all seven is 14 945.

`access` (n = 7 questions, 8 forbidden files): 8 of 8 files refused, none inconclusive, none
leaked.

### 2.4 What the baseline shows

**F1. Finding the file works, also in Polish.** Of the 48 expected sources, 45 had their file
suggested: 30 in first place and 11 in second. Questions typed without diacritics (`pl-002`,
`pl-003`, `pl-006`) and in another grammatical form than the file (`pl-004`, `pl-005`,
`pl-007`, `pl-008`, `pl-014`, `pl-018`) all found their file.

**F2. One long file starves the others.** The 116 578-character file matched most English
questions about that project. Eleven of the 40 messages carried more than 60 000 characters
because of it, and in nine of them files ranked below it were not sent. For `en-002` the
right file was third and came back `skipped`; for `en-m01` the second file the answer needs
was fourth and came back `skipped`.

**F3. An answer deep in a long file never arrives.** `en-007`, `en-008` and `en-m03` found the
long file first and received it `truncated`. Their answers sit at characters 89 521 and
108 988, past the 80 000 the chat sends. The second one is also past the 100 000 the index
keeps, so no search could match that passage either.

**F4. Different languages do not meet.** `pl-012` and `pl-013` (Polish question, English
file) and `en-010` (English question, Polish file) did not find their file. `en-011` and
`en-012` did, through words the two languages share ("SLA", a name).

**F5. A question with no answer costs about as much as one with an answer.** The OR query
nearly always matches something, so five files went to the model for 5 of the 7 questions,
whether or not any of them helps.

**F6. Access holds on what was tested.** Each of the 8 forbidden files was found by its
owner's search and not by the asker's, and each of their projects answered 404 to the asker.
This covers the suggestion route and search for people who can ask. It is not an audit of
every route.

### 2.5 A simulation of other ways to choose context

`scripts/eval-context-chunks.mjs` cuts the same corpus into chunks, indexes them in SQLite
FTS5 with the application's tokenizer and query builder, and runs the same questions through
several strategies. It is not the application: see section 4.

It counts delivery by the same rule as the baseline: a quote reached the provider from its
own file, including any generated label. It also reports `passageDelivered` separately: the
quote is present in a selected source slice at its expected locator, not merely in a label.
Context size is the length of the message the chat would write around the chosen text, with
the same opening sentence and `FILE:` lines. The passage budget counts restored gaps, labels
and omission markers; the total budget also counts the message and file headings.

Its choice of files was checked against the application. Choosing files the way the
application does, it returns the same files in the same order as the application suggested,
for 54 of 54 questions. So a difference from the baseline does not come from how files are
ranked. The check says nothing about passages: the application has none to compare with.

| Strategy | Found | Delivered | Mean characters | Most |
|---|---|---|---|---|
| Baseline (measured) | 37 | 32 | 25 588 | 80 626 |
| Best 12 chunks, small chunks (mean 330 characters) | 37 | 33 | 4 363 | 8 219 |
| Best 12 chunks, joined chunks (mean 1 101 characters) | 37 | 35 | 8 231 | 16 676 |
| Files, then passages | 37 | 37 | 6 131 | 10 736 |

Each row: n = 40 scored questions, all of which sent context. After review 3 the simulation
counts the serialized budget, retains each page or sheet label and distinguishes selected
source passages from labels. For this dev set, passage delivery equals delivery in every row.
The preceding revision gave 33, 35 and 37 delivered at 4 221, 8 142 and 6 111 characters;
the baseline did not change. Earlier revisions rewrote headings into the text.

`no-answer` questions (n = 7; in every row 5 of them sent context, 2 sent nothing):

| Strategy | Mean over all 7 | Mean over the 5 that sent |
|---|---|---|
| Baseline (measured) | 14 945 | 20 924 |
| Files, then passages | 4 847 | 6 785 |

Three things follow.

1. **Chunks alone are not the fix.** Ranking small chunks across the project delivered 33 of
   40, one more than today. It lost `en-006`, `en-012` and `en-m02`, which today work: the
   words of the question are spread over several sections of one document, a whole file
   gathers them, and a small chunk does not.
2. **Larger chunks help, at a price.** Letting neighbouring sections share a chunk delivered
   35 of 40, with about a third more text than the two-step strategy.
3. **Keeping the file ranking and choosing passages inside each file is best here.** It
   delivers everything the baseline finds, including all five questions lost to the long file,
   and sends about a quarter of the text.

---

## 3. Decisions

### Decision 0: choose files, then passages

**Decision.** Context is chosen in two steps.

1. *Files:* as today. In Auto mode, the files `suggest-files` ranks for the question; in
   Manual mode, the files the member picked.
2. *Passages:* each of those files, in order, brings its whole extracted text when that is at
   most 6 000 characters long, exactly as the chat sends a file today, and otherwise its best
   passages for the question, up to 6 000 characters, in the order they have in the file. A
   passage is sent as the file has it, under a label (decision 1). No file can use the room of
   another. The total is capped by the budget of decision 4.

**Why.** F2 and F3 are both the result of filling one budget with whole files in order
(`app/api/chat/route.ts:25`). The simulation delivers 37 of 40 this way against 32, with
6 131 characters on average against 25 588.

**Rejected.**
- *Rank chunks across the project and drop the file step.* Measured: 33 of 40 with small
  chunks, 35 with joined ones, and three questions that work today stop working.
- *Keep whole files and raise the budget.* The answer to `en-007` sits at character 108 988;
  the budget would have to exceed the whole file, and every message would cost more than the
  25 588 characters it already averages.
- *Cut every file to a fixed length.* It would stop one file from starving the others (F2),
  and would still never reach an answer deep in a long file (F3).

**Consequence.** The limit of five files and the ranking stay as they are, so what was
measured for F1 keeps holding. The two numbers of 6 000 characters are constants in the
simulation, set when the strategy was written and not changed after its first run. The
history of this branch cannot prove that, so take them as untuned on the builder's word only;
the holdout set decides whether they stay.

### Decision 1: the chunk, its size and its ID

**Decision.**
- *A chunk is a slice of the file's text,* given by its start and end. Its text is never
  rewritten: headings, table rows and line breaks stay where the file has them. Consecutive
  selected chunks with the same label are sent as the exact span between them, including
  any intervening whitespace. Leading and trailing whitespace outside the units is omitted.
- *Unit.* A chunk is made of whole units, cut along the file's structure: paragraphs; each
  Markdown heading line as a unit of its own; each row of a sheet; each PDF page's paragraphs,
  with the page as their place.
- *Size.* Units are joined in order until a chunk has about 1 500 characters. A chunk never
  crosses a page or a sheet. It may cross a heading, whose line is then simply part of its
  text. No chunk is longer than 2 400 characters.
- *Label.* What a chunk is about travels beside its text and is sent as a label line above
  it: the page or sheet, the headings above it (`Runbook › Deploying`), and for a sheet its
  header row, so that a row is never sent without the names of its columns. The label is
  searched too, using the full heading trail or sheet header rather than the display label.
  A heading trail or header row longer than 1 000 UTF-16 code units is cut at a character
  boundary in the display label and marked with an ellipsis; the exact heading locator is
  kept separately. For a cut sheet header, the last columns have no name in the label, and
  the manifest says so. Consecutive pages, sheets or headings retain their labels.
- *Long lines.* A unit longer than the maximum is cut into pieces of at most 1 500
  characters: at the last line end in reach, else the last space or tab, else inside the
  text, never between the two halves of a character outside the BMP. Nothing is dropped and
  nothing is added to the source slice. A passage is selected only if the serialized text,
  including labels and any restored gaps, fits the file's allowance.
- *No overlap,* with one exception in how passages are chosen: pieces cut from one unit are
  linked, and when one is chosen the pieces it is linked to come along while the file's
  allowance has room. Sent together, they are one slice of the file, so a word or a sentence
  cut in two reads whole again.
- *Line endings.* Text is cut after CRLF is turned into LF, so a file gives the same chunks
  on every system.
- *Address and stamp.* A chunk is addressed by its file and its ordinal in that file. It also
  carries a stamp, `chunk_key`: the first 20 hexadecimal characters of
  `sha256(file SHA-256 + ":" + extractor version + ":" + ordinal)`. The stamp says which
  content the chunk had; it is not an address, because two files with the same bytes have
  the same stamps. Stored with the chunk: the start and end in the file's text, and a locator
  (`page`, `sheet` with its rows, or `heading`).
- *Version of a file* means the SHA-256 of its bytes, which `files` already has
  (`db/schema.ts:134`).

**Why.** Joined chunks delivered more than small ones as a ranking of their own (section
2.5). A row of a spreadsheet says nothing without its header: `pl-002` expects "Tester 120",
which is only an answer next to the column name. An earlier draft repeated headings and the
header row inside the chunk's text; a review showed that this rewrote what the file says (a
Markdown heading became a trail, a heading with no text under it vanished) and that pieces
of a cut line were rejoined with a blank line inside a word. Slices plus a label keep both:
the text as it is, and what it is about.

`tests/eval-context-rules.test.ts` pins the rule down: every chunk is a slice and
consecutive chunks give the text back; the same chunks with LF and CRLF; heading lines kept,
also with no text under them; no chunk past the maximum; no lone half of a character; a
quote across a cut inside a word delivered when both pieces are sent and not when one is;
linked pieces brought along; every chunk of a sheet labelled with its header, cut and marked
when it is too long.

The stamp has to survive two things the code does today: re-uploading a file gives it a new
row ID (`files/route.ts:117`–`129`), and re-indexing rewrites its text. A stamp made from the
content hash stays the same for the same bytes and changes when the bytes or the extractor
change. It cannot also be the address: two uploads with identical bytes can sit at two paths
in one project, and would share every stamp. Decision 5 says how a citation finds its chunk.

**Rejected.**
- *Fixed windows with overlap.* They cut sentences and table rows, and repeated text has to
  be removed again before it is sent or cited.
- *One chunk per sentence.* Many more rows, and ranking very short texts is the weakness the
  small chunks already showed.
- *A random ID per chunk.* It would not survive a re-upload or a re-index, and every stored
  citation would point at nothing.
- *The hash of the chunk's own text.* Identical paragraphs in two places would share an ID.
- *The stamp as the address.* The first version of this decision did that. A review showed
  that two identical files in one project then answer to the same key.
- *Overlap between all chunks.* Repeated text would have to be removed again before it is
  sent or cited. Linking the pieces of a cut unit covers the one case where a cut can fall
  inside a sentence or a word.
- *Headings and header rows written into the chunk's text.* The previous draft. It changes
  the text that is sent and cited, see above.

**Not measured.** The simulation applies the long-line rule and the linking of pieces, but
the dev corpus has no unit longer than the maximum and no header row longer than 1 000
characters, so neither has changed a result. The holdout set is to contain such files.

### Decision 2: storage and migration

**Decision.** A new table `file_chunks` (`file_id` with cascade delete, `project_id`,
`ordinal`, `chunk_key`, `heading`, `locator`, `start_char`, `end_char`, `content`; primary key
`file_id, ordinal`) and an FTS5 table `file_chunks_fts(path, heading, content)` kept in step
by triggers, as `file_texts_fts` is (`drizzle/0003_search_index.sql`). The migration,
`0009_file_chunks.sql`, only creates. It reaches the hosted instance through
`npm run sites:migrations` under the same name (`deploy/sites/README.md`).

`file_texts` stays untouched. It keeps the reading state of a file and the file-level index
that step 1 and the Ctrl K search use. No row is rewritten: a file that has text but no
chunks counts as waiting, and the existing indexing rounds (`search-index.ts:68`) fill the
table five files at a time.

Passage indexing reads at most the first 120 000 characters per file and, for PDF, at most
the first 40 pages as well. It has a ceiling of 600 chunks, which these text limits do not
reach. Longer files are marked as partly indexed with a reason; some oversized documents are
refused with a reason rather than indexed partially. Answers beyond these limits cannot reach
a passage, so F3 (answers deep in long files) is only partly addressed.

`chunk_key` is indexed but not unique: identical files share their stamps (decision 1). A
citation finds its chunk through the file's path (decision 5), so a project must hold one
file per path. The upload route keeps it that way by replacing rows with the same path
(`files/route.ts:117`–`129`), but the database does not enforce it: `files` has no unique
index on project and path (`db/schema.ts:137`–`140`). Adding that index is part of this step,
after the hosted data has been checked for duplicates in a backup.

**Why.** Nothing measured needs `file_texts` to change, and a migration that only creates
cannot lose data. D1 allows 100 bound parameters per statement, so chunks are inserted one
statement each in a batch, as files already are (`files/route.ts:124`–`131`). Chunks are slices,
so they hold the file's text once more and no more: for the dev corpus 148 686 characters
of chunks for 38 files. Text storage roughly doubles, because `file_texts` keeps its copy.

**Rejected.**
- *Chunks as JSON inside `file_texts`.* No full-text index per chunk, and one row would
  approach D1's 2 MB limit for a long file.
- *Rebuild `file_texts` in the same step.* A table rebuild on the hosted line is the riskiest
  kind of migration (`AGENTS.md`), for no measured gain.
- *Chunk text in R2.* It cannot be searched there.

### Decision 3: one extraction, with boundaries kept

**Decision.** One function reads a file into blocks, each with its place: a PDF page by page
(today `mergePages: true`, `pdf-text.ts:28`), a spreadsheet sheet by sheet, Markdown by
heading, other text by paragraph. The file-level text and the chunks are both made from those
blocks, in the indexing round. The chat stops extracting and reads chunks from D1. A file
attached before it was indexed is read once through the same function, and the result is
stored.

Quotes and citations are compared after every run of whitespace is collapsed to one space.

**Why.** Today the chat reads each attached file from R2 and parses it again for every
message (`chat/route.ts:49`), a PDF included. The two extractions also disagree about how
much of a file exists: 100 000 characters for search, 80 000 for the chat. A PDF breaks lines
where the page layout does: the quote for `pl-001` runs across a line break, and a comparison
that kept the break would never match a sentence copied from the document.

**Rejected.**
- *Keep two extractions.* The cost per message stays, and so does the disagreement.
- *Extract in the browser.* The server could no longer say what the model received.

**Consequence.** A locator for a spreadsheet can name the sheet's number but not its name,
until the extractor reads `xl/workbook.xml`.

### Decision 4: a budget per model, and history on the server

**Decision.**
- The server counts the budget in tokens for the model that answers:
  `window − answer reserve − project instructions − history − passages`.
- The context window of a model is marked by whoever manages its connection, next to the
  marks for Effort. Unmarked models get 16 000 tokens.
- Passages may use at most 35% of the window and at most 8 000 tokens. History gets the
  newest turns first, up to 25% of the window.
- Tokens keep being estimated as characters divided by four (`chat-stream.ts:112`), and the
  estimate is corrected over time by the usage providers report, which the chat already
  stores.
- The server reads the conversation's stored messages itself. The request carries the new
  message and the conversation ID. During the change the `messages` array is still accepted.

**Why.** The 80 000 characters apply to every model alike (`chat/route.ts:16`), whether its
window is 8 000 tokens or a million. The browser decides how much history to send
(`chat-workspace.tsx:353`), so no single place knows the size of the request before it is
sent. A record of what went to a provider (decision 7) is only trustworthy when the server
assembled it.

**Rejected.**
- *A tokenizer in the Worker.* Tokenizers differ per provider, and MeshKeep accepts any
  OpenAI-compatible one.
- *Ask the provider for the window.* A model list returns names; only some providers add a
  context length.
- *Keep history in the browser.* The budget cannot be enforced there.

**Consequence.** Moving history is a change to the chat contract
(`lib/contracts/conversations.ts:62`) and gets its own pull request.

### Decision 5: citations

**Decision.**
- *What the model sees.* Each passage is sent under a short number, its path and its label:
  `[3] umowa-ramowa.pdf · page 4`, then the text as the file has it. The model is asked to put
  the number after the sentence it supports and to use only the numbers shown.
- *What the server keeps.* When the answer is complete, the server reads the numbers in it.
  A number that was not sent is removed from the stored answer. Each remaining one is stored
  as a citation: number, path of the file, ordinal of the chunk, `chunk_key`, file SHA-256
  and locator. No text of the passage is stored with the answer.
- *How a citation finds its passage.* By project, path and ordinal. The file at that path
  is looked up in the project, the chunk with that ordinal is taken, and its `chunk_key` is
  compared with the one in the citation. Equal: this is the passage that was cited.
  Different: the file has changed since, and the interface says so. No file at that path:
  the source is no longer available, and the interface says that. Two files with the same
  bytes are two sources, because they have two paths. A renamed file reads as no longer
  available. A file replaced by one with the same bytes at the same path resolves the old
  citation again: it is the same text, so the citation is still true, and this is intended.
- *What a citation keeps, and what deleting a file does to it.* No text of the passage is
  kept. A citation does keep metadata: the file's path, the ordinal, the label (page, sheet,
  headings, which can say a good deal), the file's SHA-256 and the stamp. Anyone who can
  read the conversation sees it, for as long as the answer exists. Deleting a file removes
  that metadata from every citation and passage list that points at it: what remains is
  "a deleted file", the number and nothing else, so a deleted file's citation can never
  resolve again. Replacing a file without deleting it keeps its citations, which then read
  as changed.
- *What this does not cover.* The answer's own text may quote the file, as any answer may.
  What a provider or a backup keeps follows their own rules. And today, before any of this,
  each answer already keeps the paths of the files it was sent, after they are deleted, on
  purpose (`db/schema.ts:196`–`199`). Whether deleting a file should also remove its path
  there is the owner's call (section 8); the product describes whichever is chosen where it
  describes deleting.
- *The manifest.* `contextFile` keeps its four states, so stored answers still read. A file
  sent whole stays `included`. A file sent by passages is `truncated`, with a note such as
  "3 of 78 passages", and gains an optional list `passages` (number, ordinal, `chunk_key`,
  locator, length). The answer gains an optional list of the numbers it cited.
- An answer without citations is still an answer. The interface shows what was sent and what
  was cited as two different things.

**Why.** A model copies a short number reliably and garbles a 20-character key. Checking on
the server means a citation in a stored answer always points at a passage that was in the
request. The optional fields leave `readContextFiles` (`chat-stream.ts:116`) and every stored
message valid.

**Rejected.**
- *Ask the model for verbatim quotes and match them.* Long answers, and the match breaks on
  whitespace and on a model that tidies a quote.
- *A structured JSON answer.* Not every OpenAI-compatible provider supports it, and the
  answer could no longer stream as Markdown.
- *Attribute sentences to passages afterwards by similarity.* It would be a guess shown as a
  fact.
- *Keep the first 300 characters of a cited passage with the answer.* The first version of
  this decision did, so that a citation would still show something after its file is gone.
  A review pointed out that it keeps text of a deleted file, against what deleting promises.
  It could come back only as a choice a project makes knowingly, with its access, how long
  it is kept and how it is deleted written down.
- *Find a passage by `chunk_key` alone.* Two identical files in one project share their
  keys, so the lookup would return two passages or the wrong one.

### Decision 6: access

**Decision.** Passages are chosen in SQL, restricted to the project of the message, after the
same access check the route already makes (`chat/route.ts:93`, `suggest-files/route.ts:18`).
The route that opens a cited passage takes the project, the path of the file and the ordinal
of the chunk, checks read access to the project and answers 404 for anything else, like
`access.ts:45`. A key alone never opens a passage. If context ever spans projects, the read
rule goes inside the query, as in `app/api/search/route.ts:34`.

**Why.** It is how files work today, and it held for each of the 8 forbidden files of the
`access` questions. They stay in the set as a regression check for every later change.

**Rejected.**
- *Retrieve first, filter in code.* Content from a closed project would leave the database,
  and counts or ranks could reveal that it exists.
- *Treat the key as permission.* It is derived from the file's content, not a secret.

### Decision 7: provenance

**Decision.** The assistant message records the connection that answered (its ID and the host
of its address) next to the model it already stores, and the passages that were sent, in the
manifest of decision 5. Two columns are added to `messages` by a migration that only adds
columns. No audit event is written per answer.

**Why.** "Which text went to which provider" is then a question the stored answer answers by
itself, also after the file or the connection is gone; the manifest is a snapshot on purpose
(`db/schema.ts:196`–`199`). `usage_events` already keeps the connection for usage
(`db/schema.ts:216`), but not what was sent. The activity log shows the last 200 events, and
one per answer would push everything else out.

**Rejected.**
- *A table linking every message to every chunk.* Many rows for a report nobody has asked
  for yet. A later migration can build it from the snapshots.
- *Audit events.* For the reason above.

### Decision 8: when vector search

**Decision.** Not now. Vector or hybrid search is considered when all of these hold, after
decision 0 is built:

1. on the holdout set, among at least 20 questions tagged `cross-language` or `synonym`,
   fewer than 80% find every expected file;
2. the development set points the same way;
3. expanding the query first, by asking the chat model for search words in the languages of
   the project, measured on the same questions, does not reach 80%.

**Why.** Where the question and the file share words, the lexical index found the file in 35
of 35 questions; `synonym` found 3 of 3. It fails across languages, 2 of 5, and five
questions cannot carry a decision of this size. Embeddings would also send the text of every
file to an embedding provider when it is indexed. That is a new flow of data out of the
installation, which the project policies planned for later would have to cover, so the bar
is set before the work.

**Rejected.**
- *Add vectors now.* The gain is unmeasured and the cost is a new index, a new provider and a
  new data flow.
- *Rule them out for good.* F4 is real; the question is how large it is on questions nobody
  here wrote.

---

## 4. Measured and assumed

**Measured through the application** (`baseline.json`, two identical runs):
- which files are suggested for each question, and in what order;
- what text reaches the provider from each file, and what the chat reports for each file;
- the size of the message that carries the files;
- refusals for each of the 8 forbidden files, each with its owner's control search.

**Measured outside the application** (`simulation.json`, two identical runs):
- the strategies of section 2.5, on SQLite in Node, with the application's tokenizer and
  query builder, counted by the same rules as the baseline. Its file ranking agreed with the
  application on 54 of 54 questions. Passage ranking has no counterpart in the application
  to compare with.

**Checked by tests:**
- `tests/eval-context.test.ts`: every quote is in its file's extracted text; every PDF page
  number, sheet number and Markdown heading given as a locator holds its quote; the corpus
  text has LF line endings.
- `tests/eval-context-rules.test.ts`: the counting rules (a quote counts only from its own
  file, a question without sources is not scored, both denominators of context size, the
  three outcomes of an access control, a failed request stops the run) and the chunking rule
  (the same chunks with LF and CRLF, no chunk past the maximum, nothing lost from a long
  line).

**Not established:**
- that results are the same on another machine. The corpus bytes are pinned and the rules
  are tested with both line endings, but the measurement was run on one Windows machine.

**Assumed, not measured:**
- that a model answers better from 6 000 well-chosen characters than from 25 000. No model
  was called.
- the sizes: 1 500 characters per chunk, 6 000 per file, 16 000 tokens for an unmarked model,
  35% and 25% of the window. Reasoned, not tuned.
- four characters per token. Polish text is likely to need more tokens than that.
- that D1 ranks as SQLite in Node does. Same engine, different build.
- that models keep to the citation numbers they are shown.
- the cost of extraction and indexing inside a Worker's CPU limit.

## 5. What a citation promises

A citation in MeshKeep says two things: this passage was sent to the model with the question,
and it exists in this version of the file, at this place.

It does not say that the model read the passage correctly, that the sentence it stands after
follows from it, or that the document is right. Product text, the README and the interface
must not promise more than the first two.

## 6. Limits of the development set

- **One author.** The corpus, the questions and this design were written by the same agent.
  A set made that way flatters the design that follows it.
- **Small counts.** Tags have between 3 and 12 questions. One question moves a tag with five
  questions by twenty percentage points.
- **Small projects.** The largest project has 14 files, and five are suggested. In a project
  with hundreds of files the right one will be found less often than 93%.
- **One long file.** Everything about passages inside a long file rests on a single
  generated document. 37 of 38 files are short enough to be sent whole.
- **Full sentences.** Every question is a sentence. Two-word queries lean harder on stemming
  than these do.
- **Only people who can ask.** Every asker can send a chat message in the project, which
  takes edit access. What a reader finds through search alone is not measured here.
- **No duplicates and no long lines.** No two files share their bytes or a quote, and no
  line is longer than a chunk. The rules for both are tested, not exercised by the corpus.
- **No answers judged.** The measurement stops where the model begins.

Decisions 0, 1 and 8 are to be confirmed on a holdout set: built by a different agent, with
its own corpus, without reading the numbers above. It should hold several long files, at
least one project of a hundred files, files with identical bytes, files with very long
lines, questions a real team would ask, and at least 20 `cross-language` or `synonym`
questions. Nothing is to be tuned on it.

## 7. Order of work

Each step is its own pull request and is accepted on numbers from `npm run eval:context`.

| Step | What | Accepted when |
|---|---|---|
| A | Block extraction, `file_chunks`, indexing rounds fill it, one file per path enforced. No change in behaviour. | The baseline is unchanged; files readable within indexing budgets have chunks for their first 120 000 characters (at most 40 pages for a PDF), and a longer file is marked as partly indexed; oversized documents can instead be refused with a reason; a 7 000-character line is cut and nothing of it is lost; the Sites migration test passes. |
| B | Passages inside files, the per-file allowance, the neighbour rule, `passages` in the manifest. | On the dev set: at least 37 of 40 source passages delivered at their expected locators, mean context at most 8 000 characters, found still 37 of 40, all 8 forbidden files refused. On the holdout set: source-passage delivery no lower than found by more than one question in twenty. Update the application-backed evaluator to verify actual transmitted source spans and locators; a generated label alone cannot pass this criterion. |
| C | Citation numbers, validation on the server, citations in the interface. | Every stored citation points at a sent passage (API test); with two identical files in one project each citation opens its own file; a citation to a changed file says so and shows no text; after a file is deleted its citations keep only their numbers, with no path, label, hash or stamp; answers without citations still save. |
| D | History on the server, the budget per model. | A request over the budget is trimmed, not refused; the stored record equals what the provider received. |
| E | Connection and host on the message. | An answer shows which connection received which passages, after the file is deleted. |

The holdout set is built before step B merges.

## 8. Questions for the owner

1. **A citation after its file is gone.** Decision 5 now keeps no text of a passage with the
   answer: after the file is replaced or deleted, the citation says that the source has
   changed or is no longer available. The earlier draft kept 300 characters; the reviewer
   advised against it, because it holds on to text of a deleted file. Is "nothing kept" the
   rule, or should a project be able to switch a kept excerpt on knowingly?
2. **Paths after a file is deleted.** Decision 5 removes a deleted file's path, label, hash
   and stamp from its citations. Today, each answer already keeps the paths of the files it
   was sent after they are deleted (`db/schema.ts:196`–`199`), so "delete means gone" does
   not hold for file names now. Should deleting a file also remove its path from those
   records, or should the product say plainly that answers remember which files they used?
3. **Languages.** Is asking in Polish about English files, and the reverse, an everyday case
   for the people MeshKeep is for? If so, measuring query expansion is the next evaluation
   task; if not, F4 can wait for the holdout set.
4. **Unmarked models.** 16 000 tokens is a cautious default. A lower one protects small
   models, a higher one wastes less of large ones.
5. **Who builds the holdout set.**
