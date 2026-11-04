# Migrations on OpenAI Sites

The MeshKeep database on OpenAI Sites was migrated with an older line before this repository had its own. Migrations are recorded by file name, so that database cannot take the public line in `drizzle/` as it is: it has applied `0000_odd_havok` to `0004_sanitize_public_demo`, not `0000_high_mimic` to `0004_model_effort`. It reached the public schema through `0005_bridge_to_public`.

The line for Sites is therefore:

- the frozen prefix in `migrations/` (0000–0005), which that database has applied;
- every migration from 0006 on in `drizzle/`, copied unchanged and under the same name.

The public `drizzle/0005_bridge_to_public.sql` changes nothing. It only takes number 0005, so that the names match from 0006 on.

## Deploying to Sites

```bash
npm run sites:migrations -- <empty directory>
```

Put the output in place of `drizzle/` in the source handed to Sites. The platform skips the migrations it has applied and runs the new ones.

## Rules

- **New migrations go to `drizzle/` as usual** (`npm run db:generate`). They reach Sites through the script; nothing is copied by hand.
- **Never edit `migrations/`.** The database has applied every file there. The script checks each one against a pinned hash and refuses to build the line after a change.
- **Never rename or renumber `drizzle/` 0000–0005.** The script refuses that too. Without 0005 in place, the next migration would take number 0005, and Sites would skip it as already applied.

Two files in `migrations/` differ from what ran, without changing the result. `0004_sanitize_public_demo` deleted the demo data once before the project went public; here it does nothing, because the database has applied it and a new one has nothing to delete. `0005_bridge_to_public` lost the site's address from its first comment line.

`migrations/meta/` holds only the journal. drizzle-kit's snapshots describe the schema for generating new migrations and are not read when migrations are applied.

## Tests

`tests/sites-migrations.test.ts` applies both lines to SQLite and compares the resulting schemas: on a fresh database, after a new public migration, and as an upgrade of a database that has only the old line, with its rows kept and still searchable. The SQLite in Node 22 has no FTS5, so CI runs that part on Node 24.
