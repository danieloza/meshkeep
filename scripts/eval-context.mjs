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
// suggested, and did the quoted text actually reach the provider.
//
// No real model is called and nothing leaves this machine. The result is
// written to `eval/context/sets/<set>/baseline.json`; two runs give the same
// file.

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline, canAsk, normalizeText, projects as projectsSchema, questionSet, team as teamSchema } from '../eval/context/schema.ts';
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

const MIME = { md: 'text/markdown', txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function expectStatus(response, status, what) {
  if (response.status !== status) throw new Error(`${what}: expected ${status}, got ${response.status} ${response.tekst.slice(0, 300)}`);
}

async function upload(project) {
  const directory = join(SET, 'corpus', project.id);
  const names = readdirSync(directory).sort();
  // A fresh form for each attempt: the harness may send the request again,
  // and re-uploading replaces the same paths.
  const form = new FormData();
  for (const name of names) {
    const extension = name.split('.').pop();
    form.append('files', new File([readFileSync(join(directory, name))], name, { type: MIME[extension] ?? 'application/octet-stream' }));
  }
  form.append('paths', JSON.stringify(names));
  const response = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/files`, { method: 'POST', headers: { ...ORIGIN, ...as(project.owner) }, body: form });
  expectStatus(response, 201, `Upload to ${project.id}`);
  return names.length;
}

async function index(project) {
  for (let round = 0; round < 40; round += 1) {
    const response = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/search-index`, { method: 'POST', headers: { ...ORIGIN, ...as(project.owner) } });
    expectStatus(response, 200, `Indexing ${project.id}`);
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
// the file context the provider received and the manifest the chat reported.
// Any answer but 200 stops the run: it would be a fault of the measurement,
// not a result.
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
    expectStatus(response, 200, `Chat for "${text.slice(0, 60)}"`);
    const events = response.tekst.split('\n').filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
    const done = events.find((event) => event.type === 'done');
    if (!done || received.length === before) throw new Error(`Chat for "${text.slice(0, 60)}" did not reach the provider: ${response.tekst.slice(0, 300)}`);
    // File contents travel as a system message; the question is the user's.
    const sent = received.at(-1).messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    return { manifest: done.context ?? [], sent };
  }
  throw new Error(`Chat for "${text.slice(0, 60)}" was refused three times as a duplicate.`);
}

async function search(memberId, text) {
  const response = await zapytaj(`/api/search?${new URLSearchParams({ q: text })}`, { headers: as(memberId) });
  expectStatus(response, 200, `Search as ${memberId}`);
  return response.dane.files;
}

// --- Totals -----------------------------------------------------------------

const round = (value) => Math.round(value * 10_000) / 10_000;
const mean = (values) => (values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0);

function totalOf(results) {
  const firstRanks = results.map((result) => Math.min(...result.sources.map((source) => source.rank ?? Infinity))).filter(Number.isFinite);
  return {
    n: results.length,
    complete: mean(results.map((result) => (result.complete ? 1 : 0))),
    found: mean(results.map((result) => result.sources.filter((source) => source.rank !== null).length / result.sources.length)),
    firstRank: firstRanks.length ? mean(firstRanks) : null,
    delivered: mean(results.map((result) => (result.delivered ? 1 : 0))),
  };
}

function grouped(results, keysOf) {
  const groups = new Map();
  for (const result of results) {
    for (const key of keysOf(result)) groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => [key, totalOf(items)]));
}

// --- The run ----------------------------------------------------------------

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
    expectStatus(connection, 201, 'Connecting the recording provider');

    // Path and id of every file, per project, as the application stored them.
    const idOf = new Map();
    const pathOf = new Map();
    const fileText = {};
    let fileCount = 0;
    for (const project of projects) {
      fileCount += await upload(project);
      await index(project);
      const listed = await zapytaj(`/api/projects/${projectUuid.get(project.id)}/files`, { headers: as(project.owner) });
      expectStatus(listed, 200, `Listing ${project.id}`);
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
      const offered = await suggest(question.asker, question.project, question.question);
      const suggestions = offered.status === 200 ? offered.dane.files.map((file, position) => ({ rank: position + 1, file: corpusPath(file.fileId) })) : [];
      const rankOf = (file) => suggestions.find((suggestion) => suggestion.file === file)?.rank ?? null;
      const scored = question.kind === 'answerable' || question.kind === 'multi-file';

      // The message goes out whenever files were suggested, also for a
      // question with no answer: those files are sent to the model all the
      // same, and their size is what the question costs.
      let sent = null;
      let manifest = [];
      if (question.kind !== 'access' && suggestions.length) {
        ({ sent, manifest } = await chat(question.asker, question.project, question.question, suggestions.map((suggestion) => idOf.get(suggestion.file))));
      }
      const sentText = normalizeText(sent ?? '');
      const manifestCount = (status) => manifest.filter((entry) => entry.status === status).length;
      const sources = question.expected.map((source) => ({
        file: source.file,
        rank: rankOf(source.file),
        manifest: manifest.find((entry) => entry.id === idOf.get(source.file))?.status ?? null,
        delivered: sentText.includes(normalizeText(source.quote)),
      }));

      const result = {
        id: question.id,
        lang: question.lang,
        kind: question.kind,
        tags: question.tags,
        status: offered.status,
        suggestions,
        context: sent === null ? null : {
          chars: sent.length,
          included: manifestCount('included'),
          truncated: manifestCount('truncated'),
          unreadable: manifestCount('unreadable'),
          skipped: manifestCount('skipped'),
        },
        sources,
        complete: scored && sources.every((source) => source.rank !== null),
        delivered: scored && sources.every((source) => source.delivered),
      };

      if (question.kind === 'no-answer') {
        result.related = suggestions.map((suggestion) => suggestion.file).filter((file) => question.related.includes(file));
      }

      if (question.kind === 'access') {
        const closed = [...new Set(question.forbidden.map((file) => file.split('/')[0]))];
        const forbiddenProjects = [];
        for (const projectId of closed) {
          forbiddenProjects.push({ project: projectId, status: (await suggest(question.asker, projectId, question.question)).status });
        }
        // The same phrase as both people. A refusal means something only when
        // the phrase does find the file for its owner.
        const ownerOfClosed = projects.find((project) => project.id === closed[0]).owner;
        const found = async (memberId) => (await search(memberId, question.probe)).map((hit) => corpusPath(hit.fileId)).filter((file) => question.forbidden.includes(file)).sort();
        const ownerFound = await found(ownerOfClosed);
        const askerFound = await found(question.asker);
        result.access = {
          forbiddenProjects,
          probe: question.probe,
          ownerFound,
          askerFound,
          refused: ownerFound.length > 0 && askerFound.length === 0 && forbiddenProjects.every((entry) => entry.status === 404),
        };
      }

      results.push(result);
      const mark = scored ? `${result.complete ? 'found' : 'MISSED'}, ${result.delivered ? 'delivered' : 'NOT DELIVERED'}` : question.kind === 'access' ? (result.access.refused ? 'refused' : 'NOT REFUSED') : `${suggestions.length} suggested`;
      console.log(`${question.id.padEnd(7)} ${question.kind.padEnd(10)} ${mark}`);
    }

    const scored = results.filter((result) => result.kind === 'answerable' || result.kind === 'multi-file');
    const noAnswer = results.filter((result) => result.kind === 'no-answer');
    const access = results.filter((result) => result.kind === 'access');
    const contextOf = (items) => {
      const sent = items.filter((result) => result.context);
      const sum = (key) => sent.reduce((total, result) => total + result.context[key], 0);
      return {
        n: sent.length,
        meanChars: Math.round(mean(sent.map((result) => result.context.chars))),
        maxChars: Math.max(0, ...sent.map((result) => result.context.chars)),
        meanFiles: mean(sent.map((result) => result.suggestions.length)),
        included: sum('included'),
        truncated: sum('truncated'),
        unreadable: sum('unreadable'),
        skipped: sum('skipped'),
      };
    };
    const output = baseline.parse({
      version: 1,
      set: setName,
      observed: {
        mostSuggestions: Math.max(0, ...results.map((result) => result.suggestions.length)),
        files: fileCount,
        fileText: Object.fromEntries(Object.entries(fileText).sort(([a], [b]) => a.localeCompare(b))),
      },
      totals: {
        scored: totalOf(scored),
        byKind: grouped(scored, (result) => [result.kind]),
        byLang: grouped(scored, (result) => [result.lang]),
        // A question with no tag has nothing that makes retrieval hard.
        byTag: grouped(scored, (result) => (result.tags.length ? result.tags : ['plain'])),
        context: { scored: contextOf(scored), noAnswer: contextOf(noAnswer) },
        noAnswer: {
          n: noAnswer.length,
          withSuggestions: noAnswer.filter((result) => result.suggestions.length > 0).length,
          onlyRelated: noAnswer.filter((result) => result.suggestions.length > 0 && result.related.length === result.suggestions.length).length,
        },
        access: { n: access.length, refused: access.filter((result) => result.access.refused).length },
      },
      questions: results,
    });

    writeFileSync(join(SET, 'baseline.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    const { scored: all } = output.totals;
    console.log(`\nScored questions: ${all.n}. Every expected file suggested: ${Math.round(all.complete * 100)}%. Every quote delivered to the provider: ${Math.round(all.delivered * 100)}%.`);
    console.log(`Access: ${output.totals.access.refused} of ${output.totals.access.n} refused. Written to eval/context/sets/${setName}/baseline.json`);
  } finally {
    stopWorkera();
    provider.server.close();
  }
}

await run();
