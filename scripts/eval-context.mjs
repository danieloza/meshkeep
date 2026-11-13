// Measures how MeshKeep finds context today, on an evaluation set.
//
//   npm run eval:context -- dev
//
// Everything goes through the real HTTP API of a local build, as the people
// of the set: the corpus is uploaded through the upload route, indexed by the
// indexing rounds, and each question is asked the way the chat's Auto context
// asks it. The files `suggest-files` offers are then sent with a chat message
// to a model provider that runs inside this script and only records what it
// receives. So the result says two things per expected source: was its file
// suggested, and did the quoted text reach the provider in the part of the
// message that came from that file.
//
// No real model is called and nothing leaves this machine. Any request that
// fails stops the run: a failure is a fault of the measurement, never a
// result. The result is written to `eval/context/sets/<set>/baseline.json`;
// two runs give the same file.

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_CONTEXT_PREAMBLE, accessOutcome, assertStatus, contextTotal, grouped, mean, mimeOf, quoteDelivered, splitFileContext, totalOf } from '../eval/context/measure.ts';
import { baseline, canAsk, projects as projectsSchema, questionSet, team as teamSchema } from '../eval/context/schema.ts';
import { ORIGIN, jako, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from '../tests/api/harness.ts';

const setName = process.argv[2];
if (!setName) {
  console.error('Usage: npm run eval:context -- <set>');
  process.exit(2);
}
const SET = fileURLToPath(new URL(`../eval/context/sets/${setName}/`, import.meta.url));
const MODEL = 'eval-recorder';
// Limits high enough that no question is refused for budget: the run measures
// retrieval, not the usage rules.
const MEMBER_BUDGET = 2_000_000_000;

const readJson = (file) => JSON.parse(readFileSync(join(SET, file), 'utf8'));
const team = teamSchema.parse(readJson('team.json'));
const { projects } = projectsSchema.parse(readJson('projects.json'));
const { questions } = questionSet.parse(readJson('questions.json'));
const projectOf = (file) => file.split('/')[0];
const pathIn = (file) => file.slice(file.indexOf('/') + 1);

// --- The set as rows --------------------------------------------------------

const uuid = (group, index) => `${group}0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const memberUuid = new Map(team.members.map((member, index) => [member.id, uuid(1, index)]));
const projectUuid = new Map(projects.map((project, index) => [project.id, uuid(2, index)]));
// A session token is 40 to 100 characters. A repeated letter keeps secret
// scanners quiet about a string that is not a secret.
const token = new Map(team.members.map((member, index) => [member.id, String.fromCharCode(97 + index).repeat(64)]));
const as = (memberId) => jako(token.get(memberId));
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function seedSql() {
  const now = Date.now();
  const expires = now + 30 * 24 * 3600 * 1000;
  const rows = [];
  for (const member of team.members) {
    const id = memberUuid.get(member.id);
    rows.push(`INSERT INTO members (id,provider_user_id,email,display_name,role,status,created_at,updated_at) VALUES ('${id}','eval-${member.id}','${member.id}@eval.test',${quote(member.name)},'${member.role}','active',${now},${now});`);
    rows.push(`INSERT INTO member_limits (member_id,daily_tokens,monthly_tokens,enabled,updated_at) VALUES ('${id}',${MEMBER_BUDGET},${MEMBER_BUDGET},1,${now});`);
    rows.push(`INSERT INTO sessions (id,token_hash,member_id,expires_at,created_at,last_seen_at) VALUES ('eval-${member.id}','${sha256(token.get(member.id))}','${id}',${expires},${now},${now});`);
  }
  for (const project of projects) {
    const id = projectUuid.get(project.id);
    rows.push(`INSERT INTO projects (id,owner_id,name,description,visibility,storage_provider,created_at,updated_at) VALUES ('${id}','${memberUuid.get(project.owner)}',${quote(project.name)},'','${project.visibility}','r2',${now},${now});`);
    for (const member of project.members) {
      rows.push(`INSERT INTO project_members (project_id,member_id,role,created_at) VALUES ('${id}','${memberUuid.get(member.id)}','${member.role}',${now});`);
    }
  }
  return rows.join('\n');
}

// --- The recording provider -------------------------------------------------

const received = [];

function startProvider() {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'recorded' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, address: `http://127.0.0.1:${server.address().port}/v1` }));
  });
}

// --- Requests ---------------------------------------------------------------

const ok = (response, status, what) => assertStatus(response.status, status, what, response.tekst);

async function upload(project) {
  const directory = join(SET, 'corpus', project.id);
  const names = readdirSync(directory).sort();
  const form = new FormData();
  // The bytes go up exactly as they are on disk.
  for (const name of names) form.append('files', new File([readFileSync(join(directory, name))], name, { type: mimeOf(name) }));
  form.append('paths', JSON.stringify(names));
  // If the harness sends the request again, it replaces the same paths.
  const response = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/files`, { method: 'POST', headers: { ...ORIGIN, ...as(project.owner) }, body: form });
  ok(response, 201, `Upload to ${project.id}`);
  return names.length;
}

async function index(project) {
  for (let round = 0; round < 40; round += 1) {
    const response = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/search-index`, { method: 'POST', headers: { ...ORIGIN, ...as(project.owner) } });
    ok(response, 200, `Indexing ${project.id}`);
    if (response.dane.remaining === 0) return;
  }
  throw new Error(`Indexing ${project.id} did not finish in 40 rounds.`);
}

function suggest(memberId, projectId, text) {
  return zapytaj(`/api/projects/${projectUuid.get(projectId)}/suggest-files?${new URLSearchParams({ q: text.slice(0, 500) })}`, { headers: as(memberId) });
}

// The chat allows each member ten messages a minute (`RUNS_PER_MINUTE` in
// `lib/server/chat-runs.ts`). The run stays under it, so a refusal for pace is
// never mistaken for a file that did not reach the model.
const CHATS_PER_MINUTE = 8;
const chatTimes = new Map();

async function waitForTurn(memberId) {
  const times = (chatTimes.get(memberId) ?? []).filter((time) => Date.now() - time < 61_000);
  if (times.length >= CHATS_PER_MINUTE) {
    const pause = 61_000 - (Date.now() - times[0]);
    console.log(`        (waiting ${Math.ceil(pause / 1000)} s: ${memberId} has sent ${times.length} messages this minute)`);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
  chatTimes.set(memberId, [...times.filter((time) => Date.now() - time < 61_000), Date.now()]);
}

// A chat message with the given files, as the Auto context sends it. Returns
// the file-context message the provider received and the manifest the chat
// reported for it.
async function chat(memberId, projectId, text, attachmentIds) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForTurn(memberId);
    const before = received.length;
    const response = await zapytaj('/api/chat', {
      method: 'POST',
      headers: { ...ORIGIN, ...as(memberId), 'Content-Type': 'application/json' },
      // A new request id for each attempt: the same id twice is refused, and
      // a first attempt may have run although its answer was lost.
      body: JSON.stringify({ projectId: projectUuid.get(projectId), model: MODEL, messages: [{ role: 'user', content: text }], attachmentIds, clientRequestId: randomUUID() }),
    });
    if (response.status === 409) continue;
    ok(response, 200, `Chat for "${text.slice(0, 60)}"`);
    const events = response.tekst.split('\n').filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
    const done = events.find((event) => event.type === 'done');
    if (!done || received.length === before) throw new Error(`Chat for "${text.slice(0, 60)}" did not reach the provider: ${response.tekst.slice(0, 300)}`);
    // File contents travel as one system message; the question is the user's.
    const message = received.at(-1).messages.find((entry) => entry.role === 'system' && entry.content.startsWith(FILE_CONTEXT_PREAMBLE))?.content ?? '';
    return { manifest: done.context ?? [], message };
  }
  throw new Error(`Chat for "${text.slice(0, 60)}" was refused three times as a duplicate.`);
}

async function search(memberId, text) {
  const response = await zapytaj(`/api/search?${new URLSearchParams({ q: text })}`, { headers: as(memberId) });
  ok(response, 200, `Search as ${memberId}`);
  return response.dane.files;
}

// --- The run ----------------------------------------------------------------

const isScored = (kind) => kind === 'answerable' || kind === 'multi-file';

async function run() {
  for (const question of questions) {
    const project = projects.find((candidate) => candidate.id === question.project);
    if (!project || !canAsk(project, question.asker)) throw new Error(`${question.id}: ${question.asker} cannot ask in ${question.project}. Run the test in tests/eval-context.test.ts.`);
  }

  console.log(`Build: ${zbudujJesliTrzeba()}`);
  const provider = await startProvider();
  try {
    await startWorkera({ zasiej: false, zmienne: { PROVIDER_KEY_ENCRYPTION_KEY: 'k'.repeat(48) }, dodatkowySql: seedSql() });

    const owner = team.members.find((member) => member.role === 'owner').id;
    const connection = await zapytaj('/api/providers', {
      method: 'POST',
      headers: { ...ORIGIN, ...as(owner), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Recorder', baseUrl: provider.address, apiKey: 'e'.repeat(24), scope: 'team' }),
    });
    ok(connection, 201, 'Connecting the recording provider');

    // Path and id of every file, per project, as the application stored them.
    const idOf = new Map();
    const pathOf = new Map();
    const fileText = {};
    let fileCount = 0;
    for (const project of projects) {
      fileCount += await upload(project);
      await index(project);
      const listed = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/files`, { headers: as(project.owner) });
      ok(listed, 200, `Listing ${project.id}`);
      for (const file of listed.dane.files) {
        const path = `${project.id}/${file.relativePath}`;
        idOf.set(path, file.id);
        pathOf.set(file.id, path);
        fileText[file.text.status] = (fileText[file.text.status] ?? 0) + 1;
      }
      console.log(`Uploaded and indexed ${project.id}`);
    }
    const corpusPath = (fileId) => pathOf.get(fileId) ?? `unknown/${fileId}`;

    const results = [];
    for (const question of questions) {
      // In the asker's own project a suggestion request has to succeed.
      const offered = await suggest(question.asker, question.project, question.question);
      ok(offered, 200, `Suggestions for ${question.id}`);
      const suggestions = offered.dane.files.map((file, position) => ({ rank: position + 1, file: corpusPath(file.fileId) }));
      const rankOf = (file) => suggestions.find((suggestion) => suggestion.file === file)?.rank ?? null;
      const scored = isScored(question.kind);

      // The message goes out whenever files were suggested, also for a
      // question with no answer: those files are sent to the model all the
      // same, and their size is what the question costs.
      let context = null;
      let manifest = [];
      let sections = new Map();
      if (question.kind !== 'access' && suggestions.length) {
        const answer = await chat(question.asker, question.project, question.question, suggestions.map((suggestion) => idOf.get(suggestion.file)));
        manifest = answer.manifest;
        // What each file contributed, read back from the message itself. The
        // manifest says which files the message carries and in which order.
        sections = splitFileContext(answer.message, manifest.map((entry) => entry.path));
        const count = (status) => manifest.filter((entry) => entry.status === status).length;
        context = { chars: answer.message.length, included: count('included'), truncated: count('truncated'), unreadable: count('unreadable'), skipped: count('skipped') };
      }

      const sources = question.expected.map((source) => {
        const state = manifest.find((entry) => entry.id === idOf.get(source.file))?.status ?? null;
        // Delivered means: the chat says it sent text of this file, and the
        // quote is in the part of the message that came from this file.
        const sent = state === 'included' || state === 'truncated';
        return { file: source.file, rank: rankOf(source.file), manifest: state, delivered: sent && quoteDelivered(source.quote, sections.get(pathIn(source.file))) };
      });

      const result = {
        id: question.id,
        lang: question.lang,
        kind: question.kind,
        tags: question.tags,
        suggestions,
        context,
        sources,
        complete: scored ? sources.every((source) => source.rank !== null) : null,
        delivered: scored ? sources.every((source) => source.delivered) : null,
      };

      if (question.kind === 'no-answer') {
        result.related = suggestions.map((suggestion) => suggestion.file).filter((file) => question.related.includes(file));
      }

      if (question.kind === 'access') {
        // One control per forbidden file: the route of its project as the
        // asker, and its own probe as its project's owner and as the asker.
        result.access = [];
        for (const { file, probe } of question.forbidden) {
          const closed = projects.find((project) => project.id === projectOf(file));
          const finds = async (memberId) => (await search(memberId, probe)).some((hit) => corpusPath(hit.fileId) === file);
          const control = {
            routeStatus: (await suggest(question.asker, closed.id, question.question)).status,
            ownerFound: await finds(closed.owner),
            askerFound: await finds(question.asker),
          };
          result.access.push({ file, routeStatus: control.routeStatus, probe, ownerFound: control.ownerFound, askerFound: control.askerFound, outcome: accessOutcome(control) });
        }
      }

      results.push(result);
      const mark = scored
        ? `${result.complete ? 'found' : 'MISSED'}, ${result.delivered ? 'delivered' : 'NOT DELIVERED'}`
        : question.kind === 'access' ? result.access.map((entry) => entry.outcome.toUpperCase()).join(', ') : `${suggestions.length} suggested`;
      console.log(`${question.id.padEnd(7)} ${question.kind.padEnd(10)} ${mark}`);
    }

    const scored = results.filter((result) => isScored(result.kind));
    const noAnswer = results.filter((result) => result.kind === 'no-answer');
    const access = results.filter((result) => result.kind === 'access');
    const total = (items) => totalOf(items.map((result) => ({ ranks: result.sources.map((source) => source.rank), delivered: result.sources.map((source) => source.delivered) })));
    const contextOf = (items) => {
      const sent = items.filter((result) => result.context);
      const sum = (key) => sent.reduce((count, result) => count + result.context[key], 0);
      return {
        ...contextTotal(items.map((result) => result.context?.chars ?? null)),
        meanFiles: mean(sent.map((result) => result.suggestions.length)),
        included: sum('included'),
        truncated: sum('truncated'),
        unreadable: sum('unreadable'),
        skipped: sum('skipped'),
      };
    };
    const controls = access.flatMap((result) => result.access);

    const output = baseline.parse({
      version: 1,
      set: setName,
      observed: {
        mostSuggestions: Math.max(0, ...results.map((result) => result.suggestions.length)),
        files: fileCount,
        fileText: Object.fromEntries(Object.entries(fileText).sort(([a], [b]) => a.localeCompare(b))),
      },
      totals: {
        scored: total(scored),
        byKind: grouped(scored, (result) => [result.kind], total),
        byLang: grouped(scored, (result) => [result.lang], total),
        // A question with no tag has nothing that makes retrieval hard.
        byTag: grouped(scored, (result) => (result.tags.length ? result.tags : ['plain']), total),
        context: { scored: contextOf(scored), noAnswer: contextOf(noAnswer) },
        noAnswer: {
          n: noAnswer.length,
          withSuggestions: noAnswer.filter((result) => result.suggestions.length > 0).length,
          onlyRelated: noAnswer.filter((result) => result.suggestions.length > 0 && result.related.length === result.suggestions.length).length,
        },
        access: {
          n: access.length,
          refused: access.filter((result) => result.access.every((entry) => entry.outcome === 'refused')).length,
          files: controls.length,
          filesRefused: controls.filter((entry) => entry.outcome === 'refused').length,
          filesInconclusive: controls.filter((entry) => entry.outcome === 'inconclusive').length,
          filesLeaked: controls.filter((entry) => entry.outcome === 'leaked').length,
        },
      },
      questions: results,
    });

    writeFileSync(join(SET, 'baseline.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    const { scored: all, access: closed } = output.totals;
    console.log(`\nScored questions: ${all.n}. Every expected file suggested: ${Math.round(all.complete * all.n)}. Every quote delivered to the provider from its own file: ${Math.round(all.delivered * all.n)}.`);
    console.log(`Access: ${closed.filesRefused} of ${closed.files} forbidden files refused (${closed.filesInconclusive} inconclusive, ${closed.filesLeaked} leaked); ${closed.refused} of ${closed.n} questions. Written to eval/context/sets/${setName}/baseline.json`);
  } finally {
    stopWorkera();
    provider.server.close();
  }
}

await run();
