# pending migrations

A migration waits here until Troy has approved applying it to production. The runner in
`packages/core/src/migrate.ts` applies every file in `migrations/` to whatever database it is
given, so a file in `migrations/` runs as soon as anyone migrates. Move it back into
`migrations/` only in the change that goes with the approved apply, and only after the
apply has written its `_migrations` row.

Now: `072_resource_directory.sql` (resource directory, v3.4). Apply file for Troy's paste is
kept with the data work, not here.
