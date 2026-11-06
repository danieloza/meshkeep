# Deploy handoff

The contract between the agent that builds a release and the agent that deploys
it. The builder fills it in; the deployer follows it and adds what happened. It
names the hosted instance and its data, so it lives in the owner's private
workspace, next to the package, never in this repository.

A package can pass every check in `AGENTS.md` and still not be safe to deploy.
This handoff is what makes it deployable: it ties the package to reviewed code,
says what changes in the database and the environment, and says how to tell
success from failure and how to go back.

```markdown
# Release <version>: handoff

Builder: <agent>     Deployer: <agent>     Approved by the owner: <when>

## 0. Read first
Anything about the live state that changes how to deploy (for example, data the
release expects that is not there). Leave empty only after checking.

## 1. Source and package
| | |
|---|---|
| source | `main` <full SHA>, the commit the reviews and CI ran on |
| package | <file name>, <size> bytes, sha256 <digest>, <entries> entries |
| built how | the commands, and which private inputs went in (by name, never their values) |
| scanned | what was looked for (secret files, source maps, key-shaped strings, local paths) and what was found |

The deployer checks the digest before deploying and records it after.

## 2. Database
- The live migration line and journal, as the deployer's backup shows it, not as
  the builder assumes it.
- The migrations this release applies, and only those; what each one does to
  existing rows.
- Prerequisites (data that must or must not be there).

## 3. Environment
Variables and secrets that are added, changed or removed, **by name only**.
Values the release must keep unchanged are listed too (for example, an
encryption key that existing data depends on).

## 4. Backup
How the backup is taken before deploying, what it covers, and what it does not
(for example, stored files, or rows past an export limit). A backup nobody has
restored is a hope, not a recovery plan: say whether a restore was tested.

## 5. What was verified, and how
The verification script and its result, run on a copy of the live state (from
the backup, not a seeded guess), with the package itself.

## 6. After deploying
Probes anyone can run without signing in, each with the expected result: a file
only this build has, routes, headers, the smoke test. Then what the owner checks
signed in. Success is all of them; anything else is a failure to report, not to
fix on the spot.

## 7. Going back
What rolling back the code alone does after this release's migrations, and when
the database has to be restored with it. Mark each statement **tested** or
**from analysis**.

## 8. What happened (the deployer fills this in)
When, what was deployed (digest), the backup taken, each probe's result,
anything that differed from this handoff.
```
