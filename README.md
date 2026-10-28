# MeshKeep

[![CI](https://github.com/danieloza/meshkeep/actions/workflows/ci.yml/badge.svg)](https://github.com/danieloza/meshkeep/actions/workflows/ci.yml)
[![Secret Scan](https://github.com/danieloza/meshkeep/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/danieloza/meshkeep/actions/workflows/secret-scan.yml)
[![Release](https://img.shields.io/github/v/release/danieloza/meshkeep)](https://github.com/danieloza/meshkeep/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f64.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-6b7280)](#local-development)

MeshKeep is a private, self-hostable AI workspace for teams of up to four people. Projects are private by default and can be shared with selected teammates or the entire team.

The repository contains source code and placeholders only. It does not include a hosted model key, user conversations, uploaded files, email addresses, sessions, or production database exports.

## Product tour

Both videos use demonstration data and contain no production credentials or private project content.

### Product overview — 30 seconds

A concise overview of the product, privacy model, file context, team controls, and local folder synchronization. [Download the 1080p MP4](https://github.com/danieloza/meshkeep/releases/download/v0.1.0/meshkeep-product-overview.mp4).

https://github.com/user-attachments/assets/16535886-a580-48ff-8299-929f7babe623

### End-to-end workflow — 60 seconds

A deeper walkthrough built from the real interface: private projects, selected file context, bring-your-own-provider configuration, usage controls, and the audit trail. [Download the 1080p MP4](https://github.com/danieloza/meshkeep/releases/download/v0.1.0/meshkeep-product-tour.mp4).

https://github.com/user-attachments/assets/b1159807-4531-48fb-a4cc-cced15b5b8e5

## Highlights

- Private projects with owner, editor, and reader permissions
- Project-scoped conversations and explicit file context
- Streamed answers rendered as Markdown, with copyable code blocks
- Each answer lists the files the model received, and whether each arrived in full, in part, or not at all
- Project instructions sent ahead of every message in the project
- Text, code, ZIP, PDF, DOCX, XLSX, PPTX, RTF, and image uploads
- Server-side document-to-text extraction for supported documents and PDFs
- JSON context import from other assistants
- Bring-your-own OpenAI-compatible model provider
- AES-GCM encryption for provider keys stored in D1
- Windows folder-sync agent with revocable, hashed credentials
- Per-member daily and monthly token limits
- Audit log and database backup tools that exclude secrets and live sessions
- Light and dark themes

See the unauthenticated `/showcase` page for a provider-free product overview.

## Privacy and trust boundaries

The browser never receives a provider credential after it is submitted. User-supplied provider keys are validated, encrypted with AES-GCM, and then stored in D1. The encryption key lives only in `PROVIDER_KEY_ENCRYPTION_KEY` on the server. Backups omit encrypted credentials, and logs contain only provider labels and response status codes.

Local folders are not mounted or watched by the web application. Files enter a project only after an explicit browser import or through the separately authorized sync agent. A chat request receives only the files selected for that message, and the answer shows which of them reached the model and in what form. Unsupported binaries and images remain project assets and are not silently converted into model context.

Uploaded objects use random R2 keys. Invitation, session, and sync-agent credentials are stored as hashes. Authorization is enforced by server routes; client-side visibility is only a user-interface convenience.

## Model providers

MeshKeep accepts services that expose OpenAI-compatible `/models` and `/chat/completions` endpoints. A personal provider overrides the optional team default. Without either one, the optional `TOKENROUTER_API_KEY` environment fallback can be used by a self-hosted deployment.

Provider URLs must use HTTPS. Plain HTTP is accepted only for loopback addresses so a locally running Ollama or LM Studio instance can be used. Redirects, credential-bearing URLs, IP literals, and private-network hostnames are rejected to reduce SSRF and credential-forwarding risk.

## Local development

Requirements:

- Node.js 22.13 or newer
- Windows PowerShell 5.1 or newer for the folder-sync helper

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run build
powershell -ExecutionPolicy Bypass -File scripts\ensure-local-db.ps1
npm run dev -- --host 127.0.0.1 --port 3080
```

Open `http://127.0.0.1:3080/`. Development mode creates a local placeholder owner. Production uses the hosting platform identity headers and should authorize the first owner with `OWNER_ACCOUNT_USER_ID`.

Generate a strong provider-encryption secret before saving provider credentials:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the generated value into `.dev.vars` as `PROVIDER_KEY_ENCRYPTION_KEY`. Never commit `.dev.vars`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Canonical deployment origin used for metadata and social cards |
| `AUTH_MODE` | `standalone` (default) or `sites`; see [Authentication modes](#authentication-modes) |
| `OWNER_SETUP_TOKEN` | Standalone mode: secret of at least 32 characters that creates the owner and restores owner access |
| `PROVIDER_KEY_ENCRYPTION_KEY` | Server-only secret used to encrypt user-supplied provider credentials |
| `TOKENROUTER_API_KEY` | Optional legacy server-side team provider; leave blank for BYOK-only mode |
| `OWNER_ACCOUNT_USER_ID` | Sites mode: preferred first-owner bootstrap using the hosting identity |
| `OWNER_EMAIL` | Sites mode: optional legacy first-owner bootstrap by email |
| `ALLOW_FIRST_USER_BOOTSTRAP` | Sites mode: emergency bootstrap switch; leave unset in normal production |
| `GOOGLE_DRIVE_CLIENT_ID` | Experimental server-configured Drive adapter |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Experimental Drive OAuth secret |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Experimental Drive refresh token |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Optional Drive root for project copies |

The Drive adapter does not include an in-app OAuth setup flow. Treat it as experimental until your deployment supplies and manages OAuth credentials independently.

Before deploying, replace the placeholder `project_id` in `.openai/hosting.json` and inject production values through the hosting secret store.

### Authentication modes

MeshKeep identifies people in one of two ways, selected by `AUTH_MODE`:

- **`standalone` (default):** for any host other than OpenAI Sites. The owner opens `/setup` and enters `OWNER_SETUP_TOKEN`. The first use creates the owner account; later uses restore access to it. Everyone else joins through one-time invitation links. The `oai-authenticated-user-*` headers are ignored, because outside Sites a client could set them to any value.
- **`sites`:** only when OpenAI Sites sits in front of the worker. Sites sets the `oai-authenticated-user-*` headers, and the owner signs in with ChatGPT. `/setup` is disabled in this mode.

Never set `AUTH_MODE=sites` on a deployment that clients can reach without passing through Sites: anyone could then sign in as any user by sending those headers. Standalone is the default for that reason. A Sites deployment that forgets the setting loses ChatGPT sign-in, but it does not trust headers it cannot verify.

Generate the setup key the same way as the encryption key, and store it only in the hosting secret store. Rotating the secret invalidates the old key; existing sessions stay valid.

## Folder-sync agent

The PowerShell agent requires the target API origin explicitly, so a clone never points at the original deployment:

```powershell
powershell -ExecutionPolicy Bypass -File public\meshkeep-sync.ps1 `
  -ProjectId "your-project-id" `
  -Folder "C:\path\to\project" `
  -ApiUrl "https://your-meshkeep.example"
```

The agent stores its credential with Windows DPAPI, ignores common secret and build paths, and can optionally propagate local deletions. The server rejects suspicious bulk deletion even if the local script is modified.

## Testing

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run test:api
npm audit --omit=dev
```

The API suite runs against the built Worker and a fresh migrated database. Access-control tests therefore exercise real HTTP, sessions, SQL queries, and project ownership rules rather than mocks.

To verify a deployed instance from outside:

```powershell
npm run smoke -- https://your-meshkeep.example
```

## Database and backups

The public repository starts with one non-destructive baseline migration. It does not contain the one-time production cleanup migration used by the original private deployment. Later migrations in `drizzle/` only add tables and columns; apply them in order before deploying a release that includes them.

Owners can export D1 data as JSON from the Activity log. The export omits provider credentials, live sessions, invitation hashes, sync-agent hashes, and R2 object bytes. Convert a reviewed export into restoration SQL with:

```powershell
node scripts/backup-to-sql.mjs backup.json restore.sql
```

The script writes SQL but never executes it. Review the output before applying it. Saved provider credentials are intentionally not restorable; reconnect each provider with a new credential after a restore.

## Architecture

- Next.js-compatible React application built with Vinext
- Cloudflare Worker runtime
- Drizzle ORM with D1-compatible SQLite migrations
- R2-compatible object storage
- OpenAI-compatible model-provider requests
- Hosting bindings described in `.openai/hosting.json`

## Security

Read [SECURITY.md](SECURITY.md) before deploying or reporting a vulnerability. Run the complete validation suite and review generated deployment artifacts before every release.

## License

[MIT](LICENSE)
