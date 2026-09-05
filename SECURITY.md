# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential. Use GitHub's private vulnerability-reporting feature and include the affected route, reproduction steps, impact, and any relevant logs with secrets removed.

## Deployment checklist

- Keep `.dev.vars`, provider keys, encryption keys, and OAuth credentials out of Git.
- Set a unique `PROVIDER_KEY_ENCRYPTION_KEY` of at least 32 random characters before enabling saved providers.
- Store production credentials only in the hosting secret store.
- Leave `ALLOW_FIRST_USER_BOOTSTRAP` unset after the owner exists.
- Do not expose D1 or R2 bindings directly to browsers.
- Review new upload formats before adding them to the allowlist.
- Run lint, TypeScript, unit tests and the built-worker API suite before deployment.
- Use a fresh, sanitized Git history for public mirrors.
- Start new installations from the single baseline migration; never copy migration history from a private deployment.

The application encrypts saved provider credentials with AES-GCM, keeps the encryption key on the server, hashes invitation/session/agent tokens, validates request origins for state-changing browser requests, and applies project access checks on the server.
