import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenFiles = files.filter((file) =>
  /(^|\/)(\.dev\.vars|\.env(?:\.|$)|work|dist|node_modules|\.wrangler)(\/|$)/i.test(file),
);

const findings = [];
const secretPattern = /\bsk-[A-Za-z0-9_-]{32,}\b/g;
const privatePatterns = [
  /danielusz\.99/gi,
  /C:[\\/]Users[\\/]syfsy/gi,
];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (secretPattern.test(content)) findings.push(`${file}: looks like an API key`);
  secretPattern.lastIndex = 0;
  for (const pattern of privatePatterns) {
    if (pattern.test(content)) findings.push(`${file}: contains private workstation data`);
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
