import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenFiles = files.filter((file) =>
  /(^|\/)(\.dev\.vars|\.env(?:\.|$)|work|dist|node_modules|\.wrangler)(\/|$)/i.test(file),
);

const findings = [];
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{32,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const privatePatterns = [
  { pattern: /danielusz\.99/gi },
  { pattern: /C:[\\/]Users[\\/]syfsy/gi },
  // `scripts/smoke.mjs` deliberately looks for these strings in anonymous HTML.
  { pattern: /@gmail\.com/gi, allowedFiles: new Set(['scripts/smoke.mjs']) },
  { pattern: /@privaterelay\.appleid\.com/gi },
  { pattern: /danieloza\.chatgpt\.site/gi },
];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) findings.push(`${file}: looks like a credential`);
    pattern.lastIndex = 0;
  }
  for (const { pattern, allowedFiles = new Set() } of privatePatterns) {
    if (pattern.test(content) && !allowedFiles.has(file)) {
      findings.push(`${file}: contains private workstation data`);
    }
    pattern.lastIndex = 0;
  }
  if (file.startsWith('drizzle/') && file.endsWith('.sql') && /\bDELETE\s+FROM\b/i.test(content)) {
    findings.push(`${file}: public migrations must never delete existing data`);
  }
}

for (const file of forbiddenFiles) findings.push(`${file}: private or generated file is tracked`);

if (findings.length) {
  console.error('Public-repository check failed:\n' + findings.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log(`Public-repository check passed (${files.length} tracked files).`);
