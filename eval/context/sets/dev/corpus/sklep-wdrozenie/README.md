# Kormoran Shop

Online bookstore for Księgarnia Kormoran. This repository holds the storefront, the API and the background worker.

## Stack

- Node.js 22, TypeScript
- PostgreSQL 16 (one primary, one read replica)
- Redis 7 for sessions, carts and the job queue
- Server-side rendered storefront

## Local setup

1. Install dependencies with `npm ci`.
2. Start the services: `docker compose up -d postgres redis`.
3. Copy `config/local.example.env` to `config/local.env`.
4. Run the migrations: `npm run db:migrate`.
5. Load demo books: `npm run db:seed`.
6. Start everything: `npm run dev`. The storefront listens on port 4100 and the API on port 4200.

## Environment variables

| Name | Purpose |
| --- | --- |
| `SHOP_DATABASE_URL` | PostgreSQL connection string. For local development point it at `localhost:5433`, the port the compose file maps. |
| `SHOP_REDIS_URL` | Redis connection string. |
| `PAYMENTS_PROVIDER_ID` | Merchant identifier at the payment operator. Use the sandbox identifier outside production. |
| `WAREHOUSE_FEED_PATH` | Directory where the nightly warehouse CSV lands. |
| `SHOP_BASE_URL` | Public address of the storefront, used in e-mails. |

## Tests

- `npm test` runs unit tests.
- `npm run test:e2e` runs the browser tests against a local build. They need the demo books.

## Branches

Feature branches are named `feature/<ticket>-<short-name>`. Fixes for production use `hotfix/<ticket>`. Everything goes through a pull request.
