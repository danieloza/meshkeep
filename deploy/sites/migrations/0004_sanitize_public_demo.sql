-- On the original deployment this migration ran once and deleted the demo data
-- before the project went public. That database has applied it, and a new
-- database has nothing to delete, so the published copy keeps the name and does
-- nothing. This repository holds no migration that deletes data.
SELECT 1;
