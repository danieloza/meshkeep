# Runbook

## Deploying

Releases go out on Tuesday and Thursday, and always before 14:00, so that someone is around for the afternoon.

1. Check that the pipeline on `main` is green.
2. Tag the release and run `make release VERSION=x.y.z`.
3. Watch the health check for ten minutes.
4. Announce the release in the team channel.

No releases on Fridays or on the day before a public holiday.

## Rollback

If the health check fails after a release, decide within 15 minutes whether to roll back.

Run `make rollback TO=<previous version>`. It switches the storefront, the API and the worker back to the previous build.

Database migrations are forward-only. A rollback only works when the migration shipped with the release is backward compatible, which is why every migration is reviewed for that before it merges. If it is not, fix forward instead.

## Queue workers

Restart the workers with `make workers-restart`. Jobs that were running are retried from the start, so the restart is safe at any time.

## On-call

The rotation is weekly, with a handover every Monday at 10:00. The person on call acknowledges a page within 15 minutes. If nobody acknowledges within 30 minutes, the page escalates to Marek.

During the maintenance window agreed with the client, pages for planned work are muted.
