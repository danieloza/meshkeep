// Checks a running deployment from the outside.
//
//   node scripts/smoke.mjs https://your-site.example
//   MESHKEEP_SESSION=<cookie value> node scripts/smoke.mjs https://your-site.example
//
// This exists because the test suite only proves the code is correct, not that
// the thing people visit is alive. Twice in this project a core feature was
// dead in production while lint, types, build and tests were all green: the
// sync agent never ran under the PowerShell its own launcher starts, and chat
// answered 500 on every attempt across four releases. Both were found by
// running the real thing, which is what this script does.
//
// Without the session cookie it checks what an anonymous visitor can reach.
// With one it also checks that a model request leaves the server, which is the
// specific failure that survived four deployments.

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base.startsWith('http')) {
  console.error('Usage: node scripts/smoke.mjs <url>   (optionally MESHKEEP_SESSION=<cookie>)');
  process.exit(2);
}

const session = process.env.MESHKEEP_SESSION ?? '';
const results = [];

function record(ok, name, detail) {
  results.push({ ok, name, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function call(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (session) headers.Cookie = `meshkeep_session=${session}`;
  try {
    const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    return { status: response.status, text: await response.text(), headers: response.headers };
  } catch (error) {
    return { status: 0, text: String(error), headers: new Headers() };
  }
}

// A route that exists but rejects you answers 401. A route that does not exist
// answers 404. Checking the first without the second proves nothing: if the
// platform answered 401 for everything, every check below would pass while the
// deployment was empty.
async function routesExist() {
  console.log('\nRoutes present (401 = deployed, 404 = missing)');
  const control = await call('/api/definitely-not-a-real-route');
  // An address that redirects everything is a correct setup, not a failure —
  // say so instead of reporting red for a working forward.
  if (control.status >= 300 && control.status < 400) {
    const target = control.headers.get('location') ?? 'elsewhere';
    console.log(`  This address redirects to ${target}. Run the check against that instead.`);
    return;
  }
  record(control.status === 404, 'control route returns 404', `got ${control.status}`);
  if (control.status !== 404) {
    console.log('  Skipping route checks: the 404 control failed, so 401 would prove nothing.');
    return;
  }
  for (const path of ['/api/bootstrap', '/api/projects', '/api/conversations', '/api/usage', '/api/team', '/api/admin/audit', '/api/admin/backup']) {
    const response = await call(path);
    record(response.status === 401 || response.status === 403 || response.status === 200, path, `got ${response.status}`);
  }
}

async function anonymousSeesNothing() {
  console.log('\nAnonymous visitor');
  // A bare fetch here crashed the whole script when the host was unreachable
  // instead of reporting a failure. Go through the same guarded helper as the
  // other checks, which turns a transport error into status 0.
  const page = await call('/');
  const html = page.text;
  record(page.status === 200, 'home page loads', page.status === 0 ? 'host unreachable' : `got ${page.status}`);
  if (page.status === 0) return;
  // Anything that looks like private data on a page served without credentials
  // is a leak, whatever else is true.
  const leaks = ['@gmail.com', '@sites.test', 'TOKENROUTER_API_KEY='].filter((needle) => html.includes(needle));
  record(leaks.length === 0, 'no private data in anonymous HTML', leaks.join(', ') || 'clean');

  const headers = page.headers;
  record(Boolean(headers.get('content-security-policy')), 'content-security-policy header');
  record(headers.get('x-content-type-options') === 'nosniff', 'x-content-type-options: nosniff');
  record(Boolean(headers.get('strict-transport-security')), 'strict-transport-security header');
}

async function agentRoutesRefuseStrangers() {
  console.log('\nAgent routes without a key');
  const project = '00000000-0000-4000-8000-000000000000';
  for (const method of ['POST', 'DELETE']) {
    // No credentials on purpose: `call` only attaches a cookie when one is set,
    // and this check is about what a stranger gets.
    const response = await call(`/api/projects/${project}/files`, { method });
    record(response.status === 401 || response.status === 403, `${method} rejected`, response.status === 0 ? 'host unreachable' : `got ${response.status}`);
  }
}

// The check this script was written for. We are not asserting that the model
// answered — that needs a real provider key and would cost money on every run.
// We assert the request LEFT the server. 500 is the one status that means it
// never did.
async function modelRequestLeavesTheServer() {
  console.log('\nModel request (needs MESHKEEP_SESSION)');
  if (!session) {
    console.log('  Skipped: set MESHKEEP_SESSION to the session cookie of a signed-in owner.');
    return;
  }
  const projects = await call('/api/projects');
  if (projects.status !== 200) {
    record(false, 'session is valid', `/api/projects returned ${projects.status}`);
    return;
  }
  record(true, 'session is valid');

  const first = (JSON.parse(projects.text).projects ?? [])[0];
  if (!first) {
    console.log('  Skipped: the account has no project to send a message in.');
    return;
  }

  // Take the model id from the deployment itself rather than hard-coding one.
  // A provider's free pool changes without notice — two of the ids this app
  // once shipped have already disappeared from the catalogue — and a stale id
  // here would make the check pass for the wrong reason.
  const boot = await call('/api/bootstrap');
  const model = boot.status === 200 ? (JSON.parse(boot.text).models ?? [])[0]?.id : undefined;
  if (!model) {
    record(false, 'deployment advertises a model', `/api/bootstrap returned ${boot.status}`);
    return;
  }
  record(true, 'deployment advertises a model', model);

  const chat = await call('/api/chat', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: first.id,
      model,
      messages: [{ role: 'user', content: 'Smoke check.' }],
    }),
  });
  record(chat.status !== 500, 'request reaches the provider', `got ${chat.status}${chat.status === 500 ? ' — it broke inside the runtime before going out' : ''}`);
}

await routesExist();
await anonymousSeesNothing();
await agentRoutesRefuseStrangers();
await modelRequestLeavesTheServer();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
if (failed.length) {
  console.log('Failed: ' + failed.map((r) => r.name).join(', '));
  process.exit(1);
}
