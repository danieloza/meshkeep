# Architecture

## Components

- **Storefront.** Server-side rendered pages. Talks only to the API.
- **API.** Catalogue, carts, orders, customers, payments. Stateless.
- **Worker.** Background jobs: e-mails, invoices, warehouse import, order export.
- **PostgreSQL.** One primary and one read replica. The storefront's catalogue pages read from the replica.
- **Redis.** Sessions, carts and the job queue.

## Data flows

- The warehouse sends a CSV with stock levels and prices. The worker imports it every night at 03:00.
- New orders are exported to the warehouse every 10 minutes.
- The payment operator confirms payments through a webhook. Until the confirmation arrives the order stays in the "awaiting payment" state.

## Limits and lifetimes

- A cart lives in Redis for 14 days after its last change, then it is dropped.
- A customer session lasts 30 days.
- The public API allows 120 requests per minute per IP address. Requests over the limit get a 429 response.
- Product search uses PostgreSQL full-text search. There is no separate search engine.

## What we chose not to build

- No microservices in stage 1. The API is one deployable.
- No separate message broker. The queue runs on Redis.
