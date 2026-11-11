# Kormoran Shop API reference

Version 1. This document describes every resource of the shop API in the same order as the admin panel menu.

## Conventions

- **Base address.** All paths are relative to the API host of the environment you were given.
- **Authentication.** Send the API key in the `Authorization` header as a bearer token. Keys are created in the admin panel and carry scopes.
- **Format.** Requests and responses are JSON, encoded as UTF-8. Dates are in UTC.
- **Money.** Amounts are in grosze, as whole numbers. A price of 39,90 zł is sent as `3990`.
- **General limit.** Every API key may send 600 requests per minute in total. A request over the limit gets `429` with a `Retry-After` header.
- **Errors.** An error response has a `code`, a `message` meant for developers and, for `422`, a list of `fields`.
- **Paging.** List endpoints return at most 100 records per page and a `next_cursor`.

## Products

A product is one book or other item in the catalogue.

### The product object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `title` | string | The title of the product. |
| `isbn` | string | The isbn of the product. |
| `price_gross` | number | The price gross of the product. |
| `vat_rate` | number | The vat rate of the product. |
| `publisher_id` | string | The publisher id of the product. |
| `stock` | number | The stock of the product. |
| `cover_url` | string | The cover url of the product. |
| `published_on` | date-time | The published on of the product. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "pro_2000",
  "title": "example title",
  "isbn": "example isbn",
  "price_gross": 31,
  "vat_rate": 38,
  "publisher_id": "pub_1185",
  "stock": 52,
  "cover_url": "example cover url",
  "published_on": "2026-09-18T10:18:00Z",
  "created_at": "2026-01-10T10:19:00Z",
  "updated_at": "2026-02-11T10:20:00Z"
}
```

### List products

`GET /v1/products`

Returns a page of products, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `title` | Only return records whose title matches exactly. |
| `sort` | `isbn` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `products:read` scope.

### Retrieve a product

`GET /v1/products/{id}`

Returns one product. Responds with `404` when the product does not exist or the key has no access to it.

### Create a product

`POST /v1/products`

Creates a product. `title` and `isbn` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second product.

Responds with `201` and the new product, or with `422` and a list of invalid fields. Requires the `products:write` scope.

### Update a product

`PATCH /v1/products/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `title`, `isbn`, `price_gross`, `vat_rate`, `publisher_id`. A request that sends an unknown field is refused with `422`.

### Delete a product

`DELETE /v1/products/{id}`

Removes the product. Deleting is refused with `409` while other records still refer to it. Requires the `products:write` scope.

### Example: create a product

```http
POST /v1/products
Authorization: Bearer <api key>
Idempotency-Key: pro-3000
Content-Type: application/json

{
  "title": "example title",
  "isbn": "example isbn",
  "price_gross": 45,
  "vat_rate": 52
}
```

The response repeats the product as stored, with its `id` and both timestamps filled in.

### Errors for products

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `products:read` or `products:write`. |
| `404` | `products_not_found` | No product has this identifier. |
| `409` | `products_in_use` | The product cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for products

The shop emits `products.created`, `products.updated` and `products.deleted`. A webhook subscribed to them receives the product object as it was right after the change.

### Notes on products

- Lists are read from the database replica. A product created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted product stays restorable from the admin panel for 30 days, then it is removed for good.

## Categories

A category groups products in the storefront menu.

### The category object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `name` | string | The name of the category. |
| `slug` | string | The slug of the category. |
| `parent_id` | string | The parent id of the category. |
| `position` | number | The position of the category. |
| `visible` | boolean | The visible of the category. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "cat_2001",
  "name": "example name",
  "slug": "example slug",
  "parent_id": "par_1148",
  "position": 45,
  "visible": true,
  "created_at": "2026-08-17T10:17:00Z",
  "updated_at": "2026-09-18T10:18:00Z"
}
```

### List categories

`GET /v1/categories`

Returns a page of categories, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `name` | Only return records whose name matches exactly. |
| `sort` | `slug` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `categories:read` scope.

### Retrieve a category

`GET /v1/categories/{id}`

Returns one category. Responds with `404` when the category does not exist or the key has no access to it.

### Create a category

`POST /v1/categories`

Creates a category. `name` and `slug` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second category.

Responds with `201` and the new category, or with `422` and a list of invalid fields. Requires the `categories:write` scope.

### Update a category

`PATCH /v1/categories/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `name`, `slug`, `parent_id`, `position`, `visible`. A request that sends an unknown field is refused with `422`.

### Delete a category

`DELETE /v1/categories/{id}`

Removes the category. Deleting is refused with `409` while other records still refer to it. Requires the `categories:write` scope.

### Example: create a category

```http
POST /v1/categories
Authorization: Bearer <api key>
Idempotency-Key: cat-3011
Content-Type: application/json

{
  "name": "example name",
  "slug": "example slug",
  "parent_id": "par_1222",
  "position": 59
}
```

The response repeats the category as stored, with its `id` and both timestamps filled in.

### Errors for categories

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `categories:read` or `categories:write`. |
| `404` | `categories_not_found` | No category has this identifier. |
| `409` | `categories_in_use` | The category cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for categories

The shop emits `categories.created`, `categories.updated` and `categories.deleted`. A webhook subscribed to them receives the category object as it was right after the change.

### Notes on categories

- Lists are read from the database replica. A category created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted category stays restorable from the admin panel for 30 days, then it is removed for good.

## Authors

An author is linked to every product they wrote or co-wrote.

### The author object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `full_name` | string | The full name of the author. |
| `slug` | string | The slug of the author. |
| `biography` | string | The biography of the author. |
| `born_on` | date-time | The born on of the author. |
| `website` | string | The website of the author. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "aut_2002",
  "full_name": "example full name",
  "slug": "example slug",
  "biography": "example biography",
  "born_on": "2026-07-16T10:16:00Z",
  "website": "example website",
  "created_at": "2026-09-18T10:18:00Z",
  "updated_at": "2026-01-10T10:19:00Z"
}
```

### List authors

`GET /v1/authors`

Returns a page of authors, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `full_name` | Only return records whose full name matches exactly. |
| `sort` | `slug` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `authors:read` scope.

### Retrieve a author

`GET /v1/authors/{id}`

Returns one author. Responds with `404` when the author does not exist or the key has no access to it.

### Create a author

`POST /v1/authors`

Creates a author. `full_name` and `slug` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second author.

Responds with `201` and the new author, or with `422` and a list of invalid fields. Requires the `authors:write` scope.

### Update a author

`PATCH /v1/authors/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `full_name`, `slug`, `biography`, `born_on`, `website`. A request that sends an unknown field is refused with `422`.

### Delete a author

`DELETE /v1/authors/{id}`

Removes the author. Deleting is refused with `409` while other records still refer to it. Requires the `authors:write` scope.

### Example: create a author

```http
POST /v1/authors
Authorization: Bearer <api key>
Idempotency-Key: aut-3022
Content-Type: application/json

{
  "full_name": "example full name",
  "slug": "example slug",
  "biography": "example biography",
  "born_on": "2026-09-18T10:18:00Z"
}
```

The response repeats the author as stored, with its `id` and both timestamps filled in.

### Errors for authors

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `authors:read` or `authors:write`. |
| `404` | `authors_not_found` | No author has this identifier. |
| `409` | `authors_in_use` | The author cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for authors

The shop emits `authors.created`, `authors.updated` and `authors.deleted`. A webhook subscribed to them receives the author object as it was right after the change.

### Notes on authors

- Lists are read from the database replica. A author created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted author stays restorable from the admin panel for 30 days, then it is removed for good.

## Publishers

A publisher supplies products and their cover images.

### The publisher object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `name` | string | The name of the publisher. |
| `slug` | string | The slug of the publisher. |
| `country` | number | The country of the publisher. |
| `contact_name` | string | The contact name of the publisher. |
| `discount_percent` | number | The discount percent of the publisher. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "pub_2003",
  "name": "example name",
  "slug": "example slug",
  "country": 52,
  "contact_name": "example contact name",
  "discount_percent": 66,
  "created_at": "2026-01-10T10:19:00Z",
  "updated_at": "2026-02-11T10:20:00Z"
}
```

### List publishers

`GET /v1/publishers`

Returns a page of publishers, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `name` | Only return records whose name matches exactly. |
| `sort` | `slug` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `publishers:read` scope.

### Retrieve a publisher

`GET /v1/publishers/{id}`

Returns one publisher. Responds with `404` when the publisher does not exist or the key has no access to it.

### Create a publisher

`POST /v1/publishers`

Creates a publisher. `name` and `slug` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second publisher.

Responds with `201` and the new publisher, or with `422` and a list of invalid fields. Requires the `publishers:write` scope.

### Update a publisher

`PATCH /v1/publishers/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `name`, `slug`, `country`, `contact_name`, `discount_percent`. A request that sends an unknown field is refused with `422`.

### Delete a publisher

`DELETE /v1/publishers/{id}`

Removes the publisher. Deleting is refused with `409` while other records still refer to it. Requires the `publishers:write` scope.

### Example: create a publisher

```http
POST /v1/publishers
Authorization: Bearer <api key>
Idempotency-Key: pub-3033
Content-Type: application/json

{
  "name": "example name",
  "slug": "example slug",
  "country": 66,
  "contact_name": "example contact name"
}
```

The response repeats the publisher as stored, with its `id` and both timestamps filled in.

### Errors for publishers

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `publishers:read` or `publishers:write`. |
| `404` | `publishers_not_found` | No publisher has this identifier. |
| `409` | `publishers_in_use` | The publisher cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for publishers

The shop emits `publishers.created`, `publishers.updated` and `publishers.deleted`. A webhook subscribed to them receives the publisher object as it was right after the change.

### Notes on publishers

- Lists are read from the database replica. A publisher created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted publisher stays restorable from the admin panel for 30 days, then it is removed for good.

## Series

A series orders products that belong together, such as the volumes of a saga.

### The series object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `name` | string | The name of the series. |
| `slug` | string | The slug of the series. |
| `volumes` | number | The volumes of the series. |
| `complete` | boolean | The complete of the series. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ser_2004",
  "name": "example name",
  "slug": "example slug",
  "volumes": 59,
  "complete": true,
  "created_at": "2026-01-10T10:19:00Z",
  "updated_at": "2026-02-11T10:20:00Z"
}
```

### List series

`GET /v1/series`

Returns a page of series, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `name` | Only return records whose name matches exactly. |
| `sort` | `slug` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `series:read` scope.

### Retrieve a series

`GET /v1/series/{id}`

Returns one series. Responds with `404` when the series does not exist or the key has no access to it.

### Create a series

`POST /v1/series`

Creates a series. `name` and `slug` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second series.

Responds with `201` and the new series, or with `422` and a list of invalid fields. Requires the `series:write` scope.

### Update a series

`PATCH /v1/series/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `name`, `slug`, `volumes`, `complete`. A request that sends an unknown field is refused with `422`.

### Delete a series

`DELETE /v1/series/{id}`

Removes the series. Deleting is refused with `409` while other records still refer to it. Requires the `series:write` scope.

### Example: create a series

```http
POST /v1/series
Authorization: Bearer <api key>
Idempotency-Key: ser-3044
Content-Type: application/json

{
  "name": "example name",
  "slug": "example slug",
  "volumes": 73,
  "complete": true
}
```

The response repeats the series as stored, with its `id` and both timestamps filled in.

### Errors for series

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `series:read` or `series:write`. |
| `404` | `series_not_found` | No series has this identifier. |
| `409` | `series_in_use` | The series cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for series

The shop emits `series.created`, `series.updated` and `series.deleted`. A webhook subscribed to them receives the series object as it was right after the change.

### Notes on series

- Lists are read from the database replica. A series created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted series stays restorable from the admin panel for 30 days, then it is removed for good.

## Carts

A cart holds the items a customer intends to buy.

### The cart object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `customer_id` | string | The customer id of the cart. |
| `currency` | string | The currency of the cart. |
| `items_count` | number | The items count of the cart. |
| `total_gross` | number | The total gross of the cart. |
| `expires_at` | date-time | The expires at of the cart. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "car_2005",
  "customer_id": "cus_1222",
  "currency": "example currency",
  "items_count": 66,
  "total_gross": 73,
  "expires_at": "2026-02-11T10:20:00Z",
  "created_at": "2026-03-12T10:21:00Z",
  "updated_at": "2026-04-13T10:22:00Z"
}
```

### List carts

`GET /v1/carts`

Returns a page of carts, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `customer_id` | Only return records whose customer id matches exactly. |
| `sort` | `currency` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `carts:read` scope.

### Retrieve a cart

`GET /v1/carts/{id}`

Returns one cart. Responds with `404` when the cart does not exist or the key has no access to it.

### Create a cart

`POST /v1/carts`

Creates a cart. `customer_id` and `currency` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second cart.

Responds with `201` and the new cart, or with `422` and a list of invalid fields. Requires the `carts:write` scope.

### Update a cart

`PATCH /v1/carts/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `customer_id`, `currency`, `items_count`, `total_gross`. A request that sends an unknown field is refused with `422`.

### Delete a cart

`DELETE /v1/carts/{id}`

Removes the cart. Deleting is refused with `409` while other records still refer to it. Requires the `carts:write` scope.

### Example: create a cart

```http
POST /v1/carts
Authorization: Bearer <api key>
Idempotency-Key: car-3055
Content-Type: application/json

{
  "customer_id": "cus_1296",
  "currency": "example currency",
  "items_count": 80,
  "total_gross": 87
}
```

The response repeats the cart as stored, with its `id` and both timestamps filled in.

### Errors for carts

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `carts:read` or `carts:write`. |
| `404` | `carts_not_found` | No cart has this identifier. |
| `409` | `carts_in_use` | The cart cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for carts

The shop emits `carts.created`, `carts.updated` and `carts.deleted`. A webhook subscribed to them receives the cart object as it was right after the change.

### Notes on carts

- Lists are read from the database replica. A cart created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted cart stays restorable from the admin panel for 30 days, then it is removed for good.

## Cart Items

A cart item is one product in a cart with its quantity.

### The cart item object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `cart_id` | string | The cart id of the cart item. |
| `product_id` | string | The product id of the cart item. |
| `quantity` | number | The quantity of the cart item. |
| `unit_price_gross` | number | The unit price gross of the cart item. |
| `added_at` | date-time | The added at of the cart item. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "car_2006",
  "cart_id": "car_1259",
  "product_id": "pro_1296",
  "quantity": 73,
  "unit_price_gross": 80,
  "added_at": "2026-03-12T10:21:00Z",
  "created_at": "2026-04-13T10:22:00Z",
  "updated_at": "2026-05-14T10:23:00Z"
}
```

### List cart-items

`GET /v1/cart-items`

Returns a page of cart-items, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `cart_id` | Only return records whose cart id matches exactly. |
| `sort` | `product_id` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `cart-items:read` scope.

### Retrieve a cart item

`GET /v1/cart-items/{id}`

Returns one cart item. Responds with `404` when the cart item does not exist or the key has no access to it.

### Create a cart item

`POST /v1/cart-items`

Creates a cart item. `cart_id` and `product_id` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second cart item.

Responds with `201` and the new cart item, or with `422` and a list of invalid fields. Requires the `cart-items:write` scope.

### Update a cart item

`PATCH /v1/cart-items/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `cart_id`, `product_id`, `quantity`, `unit_price_gross`. A request that sends an unknown field is refused with `422`.

### Delete a cart item

`DELETE /v1/cart-items/{id}`

Removes the cart item. Deleting is refused with `409` while other records still refer to it. Requires the `cart-items:write` scope.

### Example: create a cart item

```http
POST /v1/cart-items
Authorization: Bearer <api key>
Idempotency-Key: car-3066
Content-Type: application/json

{
  "cart_id": "car_1333",
  "product_id": "pro_1370",
  "quantity": 87,
  "unit_price_gross": 94
}
```

The response repeats the cart item as stored, with its `id` and both timestamps filled in.

### Errors for cart-items

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `cart-items:read` or `cart-items:write`. |
| `404` | `cart_items_not_found` | No cart item has this identifier. |
| `409` | `cart_items_in_use` | The cart item cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for cart-items

The shop emits `cart_items.created`, `cart_items.updated` and `cart_items.deleted`. A webhook subscribed to them receives the cart item object as it was right after the change.

### Notes on cart-items

- Lists are read from the database replica. A cart item created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted cart item stays restorable from the admin panel for 30 days, then it is removed for good.

## Customers

A customer is a person with an account in the shop.

### The customer object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `email` | string | The email of the customer. |
| `full_name` | string | The full name of the customer. |
| `phone` | string | The phone of the customer. |
| `marketing_consent` | boolean | The marketing consent of the customer. |
| `registered_at` | date-time | The registered at of the customer. |
| `last_order_at` | date-time | The last order at of the customer. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "cus_2007",
  "email": "example email",
  "full_name": "example full name",
  "phone": "example phone",
  "marketing_consent": false,
  "registered_at": "2026-04-13T10:22:00Z",
  "last_order_at": "2026-05-14T10:23:00Z",
  "created_at": "2026-06-15T10:24:00Z",
  "updated_at": "2026-07-16T10:25:00Z"
}
```

### List customers

`GET /v1/customers`

Returns a page of customers, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `email` | Only return records whose email matches exactly. |
| `sort` | `full_name` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `customers:read` scope.

### Retrieve a customer

`GET /v1/customers/{id}`

Returns one customer. Responds with `404` when the customer does not exist or the key has no access to it.

### Create a customer

`POST /v1/customers`

Creates a customer. `email` and `full_name` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second customer.

Responds with `201` and the new customer, or with `422` and a list of invalid fields. Requires the `customers:write` scope.

### Update a customer

`PATCH /v1/customers/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `email`, `full_name`, `phone`, `marketing_consent`. A request that sends an unknown field is refused with `422`.

### Delete a customer

`DELETE /v1/customers/{id}`

Removes the customer. Deleting is refused with `409` while other records still refer to it. Requires the `customers:write` scope.

### Example: create a customer

```http
POST /v1/customers
Authorization: Bearer <api key>
Idempotency-Key: cus-3077
Content-Type: application/json

{
  "email": "example email",
  "full_name": "example full name",
  "phone": "example phone",
  "marketing_consent": false
}
```

The response repeats the customer as stored, with its `id` and both timestamps filled in.

### Errors for customers

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `customers:read` or `customers:write`. |
| `404` | `customers_not_found` | No customer has this identifier. |
| `409` | `customers_in_use` | The customer cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for customers

The shop emits `customers.created`, `customers.updated` and `customers.deleted`. A webhook subscribed to them receives the customer object as it was right after the change.

### Notes on customers

- Lists are read from the database replica. A customer created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted customer stays restorable from the admin panel for 30 days, then it is removed for good.

## Addresses

An address is a delivery or billing address saved by a customer.

### The address object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `customer_id` | string | The customer id of the address. |
| `kind` | string | The kind of the address. |
| `street` | string | The street of the address. |
| `postal_code` | string | The postal code of the address. |
| `city` | string | The city of the address. |
| `country` | number | The country of the address. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "add_2008",
  "customer_id": "cus_1333",
  "kind": "example kind",
  "street": "example street",
  "postal_code": "example postal code",
  "city": "example city",
  "country": 108,
  "created_at": "2026-07-16T10:25:00Z",
  "updated_at": "2026-08-17T10:26:00Z"
}
```

### List addresses

`GET /v1/addresses`

Returns a page of addresses, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `customer_id` | Only return records whose customer id matches exactly. |
| `sort` | `kind` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `addresses:read` scope.

### Retrieve a address

`GET /v1/addresses/{id}`

Returns one address. Responds with `404` when the address does not exist or the key has no access to it.

### Create a address

`POST /v1/addresses`

Creates a address. `customer_id` and `kind` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second address.

Responds with `201` and the new address, or with `422` and a list of invalid fields. Requires the `addresses:write` scope.

### Update a address

`PATCH /v1/addresses/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `customer_id`, `kind`, `street`, `postal_code`, `city`. A request that sends an unknown field is refused with `422`.

### Delete a address

`DELETE /v1/addresses/{id}`

Removes the address. Deleting is refused with `409` while other records still refer to it. Requires the `addresses:write` scope.

### Example: create a address

```http
POST /v1/addresses
Authorization: Bearer <api key>
Idempotency-Key: add-3088
Content-Type: application/json

{
  "customer_id": "cus_1407",
  "kind": "example kind",
  "street": "example street",
  "postal_code": "example postal code"
}
```

The response repeats the address as stored, with its `id` and both timestamps filled in.

### Errors for addresses

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `addresses:read` or `addresses:write`. |
| `404` | `addresses_not_found` | No address has this identifier. |
| `409` | `addresses_in_use` | The address cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for addresses

The shop emits `addresses.created`, `addresses.updated` and `addresses.deleted`. A webhook subscribed to them receives the address object as it was right after the change.

### Notes on addresses

- Lists are read from the database replica. A address created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted address stays restorable from the admin panel for 30 days, then it is removed for good.

## Orders

An order is created when a customer checks out a cart.

### The order object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `number` | string | The number of the order. |
| `customer_id` | string | The customer id of the order. |
| `status` | string | The status of the order. |
| `total_gross` | number | The total gross of the order. |
| `delivery_method` | string | The delivery method of the order. |
| `placed_at` | date-time | The placed at of the order. |
| `paid_at` | date-time | The paid at of the order. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ord_2009",
  "number": "example number",
  "customer_id": "cus_1407",
  "status": "example status",
  "total_gross": 101,
  "delivery_method": "example delivery method",
  "placed_at": "2026-07-16T10:25:00Z",
  "paid_at": "2026-08-17T10:26:00Z",
  "created_at": "2026-09-18T10:27:00Z",
  "updated_at": "2026-01-10T10:28:00Z"
}
```

### List orders

`GET /v1/orders`

Returns a page of orders, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `number` | Only return records whose number matches exactly. |
| `sort` | `customer_id` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `orders:read` scope.

### Retrieve a order

`GET /v1/orders/{id}`

Returns one order. Responds with `404` when the order does not exist or the key has no access to it.

### Create a order

`POST /v1/orders`

Creates a order. `number` and `customer_id` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second order.

Responds with `201` and the new order, or with `422` and a list of invalid fields. Requires the `orders:write` scope.

### Update a order

`PATCH /v1/orders/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `number`, `customer_id`, `status`, `total_gross`, `delivery_method`. A request that sends an unknown field is refused with `422`.

### Delete a order

`DELETE /v1/orders/{id}`

Removes the order. Deleting is refused with `409` while other records still refer to it. Requires the `orders:write` scope.

### Example: create a order

```http
POST /v1/orders
Authorization: Bearer <api key>
Idempotency-Key: ord-3099
Content-Type: application/json

{
  "number": "example number",
  "customer_id": "cus_1481",
  "status": "example status",
  "total_gross": 115
}
```

The response repeats the order as stored, with its `id` and both timestamps filled in.

### Errors for orders

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `orders:read` or `orders:write`. |
| `404` | `orders_not_found` | No order has this identifier. |
| `409` | `orders_in_use` | The order cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for orders

The shop emits `orders.created`, `orders.updated` and `orders.deleted`. A webhook subscribed to them receives the order object as it was right after the change.

### Notes on orders

- Lists are read from the database replica. A order created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted order stays restorable from the admin panel for 30 days, then it is removed for good.

## Order Items

An order item is one product on an order, with the price at the time of purchase.

### The order item object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `order_id` | string | The order id of the order item. |
| `product_id` | string | The product id of the order item. |
| `quantity` | number | The quantity of the order item. |
| `unit_price_gross` | number | The unit price gross of the order item. |
| `vat_rate` | number | The vat rate of the order item. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ord_2010",
  "order_id": "ord_1407",
  "product_id": "pro_1444",
  "quantity": 101,
  "unit_price_gross": 108,
  "vat_rate": 115,
  "created_at": "2026-08-17T10:26:00Z",
  "updated_at": "2026-09-18T10:27:00Z"
}
```

### List order-items

`GET /v1/order-items`

Returns a page of order-items, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `order_id` | Only return records whose order id matches exactly. |
| `sort` | `product_id` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `order-items:read` scope.

### Retrieve a order item

`GET /v1/order-items/{id}`

Returns one order item. Responds with `404` when the order item does not exist or the key has no access to it.

### Create a order item

`POST /v1/order-items`

Creates a order item. `order_id` and `product_id` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second order item.

Responds with `201` and the new order item, or with `422` and a list of invalid fields. Requires the `order-items:write` scope.

### Update a order item

`PATCH /v1/order-items/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `order_id`, `product_id`, `quantity`, `unit_price_gross`, `vat_rate`. A request that sends an unknown field is refused with `422`.

### Delete a order item

`DELETE /v1/order-items/{id}`

Removes the order item. Deleting is refused with `409` while other records still refer to it. Requires the `order-items:write` scope.

### Example: create a order item

```http
POST /v1/order-items
Authorization: Bearer <api key>
Idempotency-Key: ord-3110
Content-Type: application/json

{
  "order_id": "ord_1481",
  "product_id": "pro_1518",
  "quantity": 115,
  "unit_price_gross": 122
}
```

The response repeats the order item as stored, with its `id` and both timestamps filled in.

### Errors for order-items

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `order-items:read` or `order-items:write`. |
| `404` | `order_items_not_found` | No order item has this identifier. |
| `409` | `order_items_in_use` | The order item cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for order-items

The shop emits `order_items.created`, `order_items.updated` and `order_items.deleted`. A webhook subscribed to them receives the order item object as it was right after the change.

### Notes on order-items

- Lists are read from the database replica. A order item created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted order item stays restorable from the admin panel for 30 days, then it is removed for good.

## Payments

A payment records one attempt to pay for an order through the payment operator.

### The payment object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `order_id` | string | The order id of the payment. |
| `method` | string | The method of the payment. |
| `status` | string | The status of the payment. |
| `amount_gross` | number | The amount gross of the payment. |
| `operator_reference` | string | The operator reference of the payment. |
| `confirmed_at` | date-time | The confirmed at of the payment. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "pay_2011",
  "order_id": "ord_1444",
  "method": "example method",
  "status": "example status",
  "amount_gross": 115,
  "operator_reference": "example operator reference",
  "confirmed_at": "2026-09-18T10:27:00Z",
  "created_at": "2026-01-10T10:28:00Z",
  "updated_at": "2026-02-11T10:29:00Z"
}
```

### List payments

`GET /v1/payments`

Returns a page of payments, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `order_id` | Only return records whose order id matches exactly. |
| `sort` | `method` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `payments:read` scope.

### Retrieve a payment

`GET /v1/payments/{id}`

Returns one payment. Responds with `404` when the payment does not exist or the key has no access to it.

### Create a payment

`POST /v1/payments`

Creates a payment. `order_id` and `method` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second payment.

Responds with `201` and the new payment, or with `422` and a list of invalid fields. Requires the `payments:write` scope.

### Update a payment

`PATCH /v1/payments/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `order_id`, `method`, `status`, `amount_gross`, `operator_reference`. A request that sends an unknown field is refused with `422`.

### Delete a payment

`DELETE /v1/payments/{id}`

Removes the payment. Deleting is refused with `409` while other records still refer to it. Requires the `payments:write` scope.

### Example: create a payment

```http
POST /v1/payments
Authorization: Bearer <api key>
Idempotency-Key: pay-3121
Content-Type: application/json

{
  "order_id": "ord_1518",
  "method": "example method",
  "status": "example status",
  "amount_gross": 129
}
```

The response repeats the payment as stored, with its `id` and both timestamps filled in.

### Errors for payments

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `payments:read` or `payments:write`. |
| `404` | `payments_not_found` | No payment has this identifier. |
| `409` | `payments_in_use` | The payment cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for payments

The shop emits `payments.created`, `payments.updated` and `payments.deleted`. A webhook subscribed to them receives the payment object as it was right after the change.

### Notes on payments

- Lists are read from the database replica. A payment created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted payment stays restorable from the admin panel for 30 days, then it is removed for good.

## Shipments

A shipment is a parcel sent to the customer for an order.

### The shipment object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `order_id` | string | The order id of the shipment. |
| `carrier` | string | The carrier of the shipment. |
| `tracking_number` | string | The tracking number of the shipment. |
| `status` | string | The status of the shipment. |
| `shipped_at` | date-time | The shipped at of the shipment. |
| `delivered_at` | date-time | The delivered at of the shipment. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "shi_2012",
  "order_id": "ord_1481",
  "carrier": "example carrier",
  "tracking_number": "example tracking number",
  "status": "example status",
  "shipped_at": "2026-09-18T10:27:00Z",
  "delivered_at": "2026-01-10T10:28:00Z",
  "created_at": "2026-02-11T10:29:00Z",
  "updated_at": "2026-03-12T10:30:00Z"
}
```

### List shipments

`GET /v1/shipments`

Returns a page of shipments, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `order_id` | Only return records whose order id matches exactly. |
| `sort` | `carrier` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `shipments:read` scope.

### Retrieve a shipment

`GET /v1/shipments/{id}`

Returns one shipment. Responds with `404` when the shipment does not exist or the key has no access to it.

### Create a shipment

`POST /v1/shipments`

Creates a shipment. `order_id` and `carrier` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second shipment.

Responds with `201` and the new shipment, or with `422` and a list of invalid fields. Requires the `shipments:write` scope.

### Update a shipment

`PATCH /v1/shipments/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `order_id`, `carrier`, `tracking_number`, `status`. A request that sends an unknown field is refused with `422`.

### Delete a shipment

`DELETE /v1/shipments/{id}`

Removes the shipment. Deleting is refused with `409` while other records still refer to it. Requires the `shipments:write` scope.

### Example: create a shipment

```http
POST /v1/shipments
Authorization: Bearer <api key>
Idempotency-Key: shi-3132
Content-Type: application/json

{
  "order_id": "ord_1555",
  "carrier": "example carrier",
  "tracking_number": "example tracking number",
  "status": "example status"
}
```

The response repeats the shipment as stored, with its `id` and both timestamps filled in.

### Errors for shipments

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `shipments:read` or `shipments:write`. |
| `404` | `shipments_not_found` | No shipment has this identifier. |
| `409` | `shipments_in_use` | The shipment cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for shipments

The shop emits `shipments.created`, `shipments.updated` and `shipments.deleted`. A webhook subscribed to them receives the shipment object as it was right after the change.

### Notes on shipments

- Lists are read from the database replica. A shipment created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted shipment stays restorable from the admin panel for 30 days, then it is removed for good.

## Parcel Lockers

A parcel locker is a pick-up point a customer can choose at checkout.

### The parcel locker object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `code` | string | The code of the parcel locker. |
| `city` | string | The city of the parcel locker. |
| `street` | string | The street of the parcel locker. |
| `opening_hours` | string | The opening hours of the parcel locker. |
| `active` | boolean | The active of the parcel locker. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "par_2013",
  "code": "example code",
  "city": "example city",
  "street": "example street",
  "opening_hours": "example opening hours",
  "active": true,
  "created_at": "2026-02-11T10:29:00Z",
  "updated_at": "2026-03-12T10:30:00Z"
}
```

### List parcel-lockers

`GET /v1/parcel-lockers`

Returns a page of parcel-lockers, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `code` | Only return records whose code matches exactly. |
| `sort` | `city` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `parcel-lockers:read` scope.

### Retrieve a parcel locker

`GET /v1/parcel-lockers/{id}`

Returns one parcel locker. Responds with `404` when the parcel locker does not exist or the key has no access to it.

### Create a parcel locker

`POST /v1/parcel-lockers`

Creates a parcel locker. `code` and `city` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second parcel locker.

Responds with `201` and the new parcel locker, or with `422` and a list of invalid fields. Requires the `parcel-lockers:write` scope.

### Update a parcel locker

`PATCH /v1/parcel-lockers/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `code`, `city`, `street`, `opening_hours`, `active`. A request that sends an unknown field is refused with `422`.

### Delete a parcel locker

`DELETE /v1/parcel-lockers/{id}`

Removes the parcel locker. Deleting is refused with `409` while other records still refer to it. Requires the `parcel-lockers:write` scope.

### Example: create a parcel locker

```http
POST /v1/parcel-lockers
Authorization: Bearer <api key>
Idempotency-Key: par-3143
Content-Type: application/json

{
  "code": "example code",
  "city": "example city",
  "street": "example street",
  "opening_hours": "example opening hours"
}
```

The response repeats the parcel locker as stored, with its `id` and both timestamps filled in.

### Errors for parcel-lockers

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `parcel-lockers:read` or `parcel-lockers:write`. |
| `404` | `parcel_lockers_not_found` | No parcel locker has this identifier. |
| `409` | `parcel_lockers_in_use` | The parcel locker cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for parcel-lockers

The shop emits `parcel_lockers.created`, `parcel_lockers.updated` and `parcel_lockers.deleted`. A webhook subscribed to them receives the parcel locker object as it was right after the change.

### Notes on parcel-lockers

- Lists are read from the database replica. A parcel locker created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted parcel locker stays restorable from the admin panel for 30 days, then it is removed for good.

## Coupons

A coupon lowers the price of an order when its code is entered at checkout.

### The coupon object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `code` | string | The code of the coupon. |
| `percent_off` | number | The percent off of the coupon. |
| `amount_off` | number | The amount off of the coupon. |
| `valid_from` | date-time | The valid from of the coupon. |
| `valid_to` | date-time | The valid to of the coupon. |
| `usage_limit` | number | The usage limit of the coupon. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "cou_2014",
  "code": "example code",
  "percent_off": 122,
  "amount_off": 129,
  "valid_from": "2026-01-10T10:28:00Z",
  "valid_to": "2026-02-11T10:29:00Z",
  "usage_limit": 150,
  "created_at": "2026-04-13T10:31:00Z",
  "updated_at": "2026-05-14T10:32:00Z"
}
```

### List coupons

`GET /v1/coupons`

Returns a page of coupons, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `code` | Only return records whose code matches exactly. |
| `sort` | `percent_off` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `coupons:read` scope.

### Retrieve a coupon

`GET /v1/coupons/{id}`

Returns one coupon. Responds with `404` when the coupon does not exist or the key has no access to it.

### Create a coupon

`POST /v1/coupons`

Creates a coupon. `code` and `percent_off` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second coupon.

Responds with `201` and the new coupon, or with `422` and a list of invalid fields. Requires the `coupons:write` scope.

### Update a coupon

`PATCH /v1/coupons/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `code`, `percent_off`, `amount_off`, `valid_from`, `valid_to`. A request that sends an unknown field is refused with `422`.

### Delete a coupon

`DELETE /v1/coupons/{id}`

Removes the coupon. Deleting is refused with `409` while other records still refer to it. Requires the `coupons:write` scope.

### Example: create a coupon

```http
POST /v1/coupons
Authorization: Bearer <api key>
Idempotency-Key: cou-3154
Content-Type: application/json

{
  "code": "example code",
  "percent_off": 136,
  "amount_off": 143,
  "valid_from": "2026-03-12T10:30:00Z"
}
```

The response repeats the coupon as stored, with its `id` and both timestamps filled in.

### Errors for coupons

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `coupons:read` or `coupons:write`. |
| `404` | `coupons_not_found` | No coupon has this identifier. |
| `409` | `coupons_in_use` | The coupon cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for coupons

The shop emits `coupons.created`, `coupons.updated` and `coupons.deleted`. A webhook subscribed to them receives the coupon object as it was right after the change.

### Notes on coupons

- Lists are read from the database replica. A coupon created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted coupon stays restorable from the admin panel for 30 days, then it is removed for good.

## Gift Cards

A gift card carries a balance that can pay for all or part of an order.

### The gift card object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `code` | string | The code of the gift card. |
| `initial_balance` | number | The initial balance of the gift card. |
| `balance` | number | The balance of the gift card. |
| `issued_at` | date-time | The issued at of the gift card. |
| `expires_at` | date-time | The expires at of the gift card. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "gif_2015",
  "code": "example code",
  "initial_balance": 129,
  "balance": 136,
  "issued_at": "2026-02-11T10:29:00Z",
  "expires_at": "2026-03-12T10:30:00Z",
  "created_at": "2026-04-13T10:31:00Z",
  "updated_at": "2026-05-14T10:32:00Z"
}
```

### List gift-cards

`GET /v1/gift-cards`

Returns a page of gift-cards, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `code` | Only return records whose code matches exactly. |
| `sort` | `initial_balance` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `gift-cards:read` scope.

### Retrieve a gift card

`GET /v1/gift-cards/{id}`

Returns one gift card. Responds with `404` when the gift card does not exist or the key has no access to it.

### Create a gift card

`POST /v1/gift-cards`

Creates a gift card. `code` and `initial_balance` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second gift card.

Responds with `201` and the new gift card, or with `422` and a list of invalid fields. Requires the `gift-cards:write` scope.

### Update a gift card

`PATCH /v1/gift-cards/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `code`, `initial_balance`, `balance`. A request that sends an unknown field is refused with `422`.

### Delete a gift card

`DELETE /v1/gift-cards/{id}`

Removes the gift card. Deleting is refused with `409` while other records still refer to it. Requires the `gift-cards:write` scope.

### Example: create a gift card

```http
POST /v1/gift-cards
Authorization: Bearer <api key>
Idempotency-Key: gif-3165
Content-Type: application/json

{
  "code": "example code",
  "initial_balance": 143,
  "balance": 150
}
```

The response repeats the gift card as stored, with its `id` and both timestamps filled in.

### Errors for gift-cards

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `gift-cards:read` or `gift-cards:write`. |
| `404` | `gift_cards_not_found` | No gift card has this identifier. |
| `409` | `gift_cards_in_use` | The gift card cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for gift-cards

The shop emits `gift_cards.created`, `gift_cards.updated` and `gift_cards.deleted`. A webhook subscribed to them receives the gift card object as it was right after the change.

### Notes on gift-cards

- Lists are read from the database replica. A gift card created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted gift card stays restorable from the admin panel for 30 days, then it is removed for good.

## Wishlists

A wishlist keeps the products a signed-in customer saved for later.

### The wishlist object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `customer_id` | string | The customer id of the wishlist. |
| `name` | string | The name of the wishlist. |
| `items_count` | number | The items count of the wishlist. |
| `shared` | boolean | The shared of the wishlist. |
| `updated_at` | date-time | When the record last changed, in UTC. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "wis_2016",
  "customer_id": "cus_1629",
  "name": "example name",
  "items_count": 143,
  "shared": true,
  "updated_at": "2026-04-13T10:31:00Z",
  "created_at": "2026-05-14T10:32:00Z",
  "updated_at": "2026-06-15T10:33:00Z"
}
```

### List wishlists

`GET /v1/wishlists`

Returns a page of wishlists, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `customer_id` | Only return records whose customer id matches exactly. |
| `sort` | `name` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `wishlists:read` scope.

### Retrieve a wishlist

`GET /v1/wishlists/{id}`

Returns one wishlist. Responds with `404` when the wishlist does not exist or the key has no access to it.

### Create a wishlist

`POST /v1/wishlists`

Creates a wishlist. `customer_id` and `name` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second wishlist.

Responds with `201` and the new wishlist, or with `422` and a list of invalid fields. Requires the `wishlists:write` scope.

### Update a wishlist

`PATCH /v1/wishlists/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `customer_id`, `name`, `items_count`, `shared`. A request that sends an unknown field is refused with `422`.

### Delete a wishlist

`DELETE /v1/wishlists/{id}`

Removes the wishlist. Deleting is refused with `409` while other records still refer to it. Requires the `wishlists:write` scope.

### Example: create a wishlist

```http
POST /v1/wishlists
Authorization: Bearer <api key>
Idempotency-Key: wis-3176
Content-Type: application/json

{
  "customer_id": "cus_1703",
  "name": "example name",
  "items_count": 157,
  "shared": true
}
```

The response repeats the wishlist as stored, with its `id` and both timestamps filled in.

### Errors for wishlists

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `wishlists:read` or `wishlists:write`. |
| `404` | `wishlists_not_found` | No wishlist has this identifier. |
| `409` | `wishlists_in_use` | The wishlist cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for wishlists

The shop emits `wishlists.created`, `wishlists.updated` and `wishlists.deleted`. A webhook subscribed to them receives the wishlist object as it was right after the change.

### Notes on wishlists

- Lists are read from the database replica. A wishlist created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted wishlist stays restorable from the admin panel for 30 days, then it is removed for good.

## Reviews

A review is a rating and comment a customer left for a product.

### The review object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `product_id` | string | The product id of the review. |
| `customer_id` | string | The customer id of the review. |
| `rating` | number | The rating of the review. |
| `body` | string | The body of the review. |
| `approved` | boolean | The approved of the review. |
| `created_at` | date-time | When the record was created, in UTC. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "rev_2017",
  "product_id": "pro_1666",
  "customer_id": "cus_1703",
  "rating": 150,
  "body": "example body",
  "approved": true,
  "created_at": "2026-06-15T10:33:00Z",
  "created_at": "2026-07-16T10:34:00Z",
  "updated_at": "2026-08-17T10:35:00Z"
}
```

### List reviews

`GET /v1/reviews`

Returns a page of reviews, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `product_id` | Only return records whose product id matches exactly. |
| `sort` | `customer_id` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `reviews:read` scope.

### Retrieve a review

`GET /v1/reviews/{id}`

Returns one review. Responds with `404` when the review does not exist or the key has no access to it.

### Create a review

`POST /v1/reviews`

Creates a review. `product_id` and `customer_id` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second review.

Responds with `201` and the new review, or with `422` and a list of invalid fields. Requires the `reviews:write` scope.

### Update a review

`PATCH /v1/reviews/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `product_id`, `customer_id`, `rating`, `body`, `approved`. A request that sends an unknown field is refused with `422`.

### Delete a review

`DELETE /v1/reviews/{id}`

Removes the review. Deleting is refused with `409` while other records still refer to it. Requires the `reviews:write` scope.

### Example: create a review

```http
POST /v1/reviews
Authorization: Bearer <api key>
Idempotency-Key: rev-3187
Content-Type: application/json

{
  "product_id": "pro_1740",
  "customer_id": "cus_1777",
  "rating": 164,
  "body": "example body"
}
```

The response repeats the review as stored, with its `id` and both timestamps filled in.

### Errors for reviews

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `reviews:read` or `reviews:write`. |
| `404` | `reviews_not_found` | No review has this identifier. |
| `409` | `reviews_in_use` | The review cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for reviews

The shop emits `reviews.created`, `reviews.updated` and `reviews.deleted`. A webhook subscribed to them receives the review object as it was right after the change.

### Notes on reviews

- Lists are read from the database replica. A review created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted review stays restorable from the admin panel for 30 days, then it is removed for good.

## Inventory

An inventory record holds the stock level of a product as last imported from the warehouse.

### The inventory record object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `product_id` | string | The product id of the inventory record. |
| `quantity` | number | The quantity of the inventory record. |
| `reserved` | number | The reserved of the inventory record. |
| `warehouse_code` | string | The warehouse code of the inventory record. |
| `imported_at` | date-time | The imported at of the inventory record. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "inv_2018",
  "product_id": "pro_1703",
  "quantity": 150,
  "reserved": 157,
  "warehouse_code": "example warehouse code",
  "imported_at": "2026-06-15T10:33:00Z",
  "created_at": "2026-07-16T10:34:00Z",
  "updated_at": "2026-08-17T10:35:00Z"
}
```

### List inventory

`GET /v1/inventory`

Returns a page of inventory, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `product_id` | Only return records whose product id matches exactly. |
| `sort` | `quantity` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `inventory:read` scope.

### Retrieve a inventory record

`GET /v1/inventory/{id}`

Returns one inventory record. Responds with `404` when the inventory record does not exist or the key has no access to it.

### Create a inventory record

`POST /v1/inventory`

Creates a inventory record. `product_id` and `quantity` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second inventory record.

Responds with `201` and the new inventory record, or with `422` and a list of invalid fields. Requires the `inventory:write` scope.

### Update a inventory record

`PATCH /v1/inventory/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `product_id`, `quantity`, `reserved`, `warehouse_code`. A request that sends an unknown field is refused with `422`.

### Delete a inventory record

`DELETE /v1/inventory/{id}`

Removes the inventory record. Deleting is refused with `409` while other records still refer to it. Requires the `inventory:write` scope.

### Example: create a inventory record

```http
POST /v1/inventory
Authorization: Bearer <api key>
Idempotency-Key: inv-3198
Content-Type: application/json

{
  "product_id": "pro_1777",
  "quantity": 164,
  "reserved": 171,
  "warehouse_code": "example warehouse code"
}
```

The response repeats the inventory record as stored, with its `id` and both timestamps filled in.

### Errors for inventory

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `inventory:read` or `inventory:write`. |
| `404` | `inventory_not_found` | No inventory record has this identifier. |
| `409` | `inventory_in_use` | The inventory record cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for inventory

The shop emits `inventory.created`, `inventory.updated` and `inventory.deleted`. A webhook subscribed to them receives the inventory record object as it was right after the change.

### Notes on inventory

- Lists are read from the database replica. A inventory record created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted inventory record stays restorable from the admin panel for 30 days, then it is removed for good.

## Price Lists

A price list overrides catalogue prices for a period, for example during a sale.

### The price list object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `name` | string | The name of the price list. |
| `starts_at` | date-time | The starts at of the price list. |
| `ends_at` | date-time | The ends at of the price list. |
| `percent_off` | number | The percent off of the price list. |
| `active` | boolean | The active of the price list. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "pri_2019",
  "name": "example name",
  "starts_at": "2026-04-13T10:31:00Z",
  "ends_at": "2026-05-14T10:32:00Z",
  "percent_off": 171,
  "active": true,
  "created_at": "2026-08-17T10:35:00Z",
  "updated_at": "2026-09-18T10:36:00Z"
}
```

### List price-lists

`GET /v1/price-lists`

Returns a page of price-lists, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `name` | Only return records whose name matches exactly. |
| `sort` | `starts_at` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `price-lists:read` scope.

### Retrieve a price list

`GET /v1/price-lists/{id}`

Returns one price list. Responds with `404` when the price list does not exist or the key has no access to it.

### Create a price list

`POST /v1/price-lists`

Creates a price list. `name` and `starts_at` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second price list.

Responds with `201` and the new price list, or with `422` and a list of invalid fields. Requires the `price-lists:write` scope.

### Update a price list

`PATCH /v1/price-lists/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `name`, `percent_off`, `active`. A request that sends an unknown field is refused with `422`.

### Delete a price list

`DELETE /v1/price-lists/{id}`

Removes the price list. Deleting is refused with `409` while other records still refer to it. Requires the `price-lists:write` scope.

### Example: create a price list

```http
POST /v1/price-lists
Authorization: Bearer <api key>
Idempotency-Key: pri-3209
Content-Type: application/json

{
  "name": "example name",
  "percent_off": 171,
  "active": true
}
```

The response repeats the price list as stored, with its `id` and both timestamps filled in.

### Errors for price-lists

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `price-lists:read` or `price-lists:write`. |
| `404` | `price_lists_not_found` | No price list has this identifier. |
| `409` | `price_lists_in_use` | The price list cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for price-lists

The shop emits `price_lists.created`, `price_lists.updated` and `price_lists.deleted`. A webhook subscribed to them receives the price list object as it was right after the change.

### Notes on price-lists

- Lists are read from the database replica. A price list created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted price list stays restorable from the admin panel for 30 days, then it is removed for good.

## Delivery Zones

A delivery zone sets the delivery price for a group of postal codes.

### The delivery zone object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `name` | string | The name of the delivery zone. |
| `postal_code_from` | date-time | The postal code from of the delivery zone. |
| `postal_code_to` | date-time | The postal code to of the delivery zone. |
| `price_gross` | number | The price gross of the delivery zone. |
| `free_from_gross` | string | The free from gross of the delivery zone. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "del_2020",
  "name": "example name",
  "postal_code_from": "2026-05-14T10:32:00Z",
  "postal_code_to": "2026-06-15T10:33:00Z",
  "price_gross": 178,
  "free_from_gross": "example free from gross",
  "created_at": "2026-09-18T10:36:00Z",
  "updated_at": "2026-01-10T10:37:00Z"
}
```

### List delivery-zones

`GET /v1/delivery-zones`

Returns a page of delivery-zones, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `name` | Only return records whose name matches exactly. |
| `sort` | `postal_code_from` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `delivery-zones:read` scope.

### Retrieve a delivery zone

`GET /v1/delivery-zones/{id}`

Returns one delivery zone. Responds with `404` when the delivery zone does not exist or the key has no access to it.

### Create a delivery zone

`POST /v1/delivery-zones`

Creates a delivery zone. `name` and `postal_code_from` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second delivery zone.

Responds with `201` and the new delivery zone, or with `422` and a list of invalid fields. Requires the `delivery-zones:write` scope.

### Update a delivery zone

`PATCH /v1/delivery-zones/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `name`, `postal_code_from`, `postal_code_to`, `price_gross`, `free_from_gross`. A request that sends an unknown field is refused with `422`.

### Delete a delivery zone

`DELETE /v1/delivery-zones/{id}`

Removes the delivery zone. Deleting is refused with `409` while other records still refer to it. Requires the `delivery-zones:write` scope.

### Example: create a delivery zone

```http
POST /v1/delivery-zones
Authorization: Bearer <api key>
Idempotency-Key: del-3220
Content-Type: application/json

{
  "name": "example name",
  "postal_code_from": "2026-07-16T10:34:00Z",
  "postal_code_to": "2026-08-17T10:35:00Z",
  "price_gross": 192
}
```

The response repeats the delivery zone as stored, with its `id` and both timestamps filled in.

### Errors for delivery-zones

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `delivery-zones:read` or `delivery-zones:write`. |
| `404` | `delivery_zones_not_found` | No delivery zone has this identifier. |
| `409` | `delivery_zones_in_use` | The delivery zone cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for delivery-zones

The shop emits `delivery_zones.created`, `delivery_zones.updated` and `delivery_zones.deleted`. A webhook subscribed to them receives the delivery zone object as it was right after the change.

### Notes on delivery-zones

- Lists are read from the database replica. A delivery zone created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted delivery zone stays restorable from the admin panel for 30 days, then it is removed for good.

## Stock Alerts

A stock alert notifies a customer when a product is back in stock.

### The stock alert object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `product_id` | string | The product id of the stock alert. |
| `customer_id` | string | The customer id of the stock alert. |
| `email` | string | The email of the stock alert. |
| `notified_at` | date-time | The notified at of the stock alert. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "sto_2021",
  "product_id": "pro_1814",
  "customer_id": "cus_1851",
  "email": "example email",
  "notified_at": "2026-08-17T10:35:00Z",
  "created_at": "2026-09-18T10:36:00Z",
  "updated_at": "2026-01-10T10:37:00Z"
}
```

### List stock-alerts

`GET /v1/stock-alerts`

Returns a page of stock-alerts, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `product_id` | Only return records whose product id matches exactly. |
| `sort` | `customer_id` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `stock-alerts:read` scope.

### Retrieve a stock alert

`GET /v1/stock-alerts/{id}`

Returns one stock alert. Responds with `404` when the stock alert does not exist or the key has no access to it.

### Create a stock alert

`POST /v1/stock-alerts`

Creates a stock alert. `product_id` and `customer_id` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second stock alert.

Responds with `201` and the new stock alert, or with `422` and a list of invalid fields. Requires the `stock-alerts:write` scope.

### Update a stock alert

`PATCH /v1/stock-alerts/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `product_id`, `customer_id`, `email`. A request that sends an unknown field is refused with `422`.

### Delete a stock alert

`DELETE /v1/stock-alerts/{id}`

Removes the stock alert. Deleting is refused with `409` while other records still refer to it. Requires the `stock-alerts:write` scope.

### Example: create a stock alert

```http
POST /v1/stock-alerts
Authorization: Bearer <api key>
Idempotency-Key: sto-3231
Content-Type: application/json

{
  "product_id": "pro_1888",
  "customer_id": "cus_1925",
  "email": "example email"
}
```

The response repeats the stock alert as stored, with its `id` and both timestamps filled in.

### Errors for stock-alerts

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `stock-alerts:read` or `stock-alerts:write`. |
| `404` | `stock_alerts_not_found` | No stock alert has this identifier. |
| `409` | `stock_alerts_in_use` | The stock alert cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for stock-alerts

The shop emits `stock_alerts.created`, `stock_alerts.updated` and `stock_alerts.deleted`. A webhook subscribed to them receives the stock alert object as it was right after the change.

### Notes on stock-alerts

- Lists are read from the database replica. A stock alert created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted stock alert stays restorable from the admin panel for 30 days, then it is removed for good.

## Banners

A banner is a promotional picture shown on the storefront home page.

### The banner object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `title` | string | The title of the banner. |
| `image_url` | string | The image url of the banner. |
| `link_url` | string | The link url of the banner. |
| `position` | number | The position of the banner. |
| `visible` | boolean | The visible of the banner. |
| `starts_at` | date-time | The starts at of the banner. |
| `ends_at` | date-time | The ends at of the banner. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ban_2022",
  "title": "example title",
  "image_url": "example image url",
  "link_url": "example link url",
  "position": 192,
  "visible": false,
  "starts_at": "2026-02-11T10:38:00Z",
  "ends_at": "2026-03-12T10:39:00Z",
  "created_at": "2026-04-13T10:40:00Z",
  "updated_at": "2026-05-14T10:41:00Z"
}
```

### List banners

`GET /v1/banners`

Returns a page of banners, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `title` | Only return records whose title matches exactly. |
| `sort` | `image_url` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `banners:read` scope.

### Retrieve a banner

`GET /v1/banners/{id}`

Returns one banner. Responds with `404` when the banner does not exist or the key has no access to it.

### Create a banner

`POST /v1/banners`

Creates a banner. `title` and `image_url` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second banner.

Responds with `201` and the new banner, or with `422` and a list of invalid fields. Requires the `banners:write` scope.

### Update a banner

`PATCH /v1/banners/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `title`, `image_url`, `link_url`, `position`, `visible`. A request that sends an unknown field is refused with `422`.

### Delete a banner

`DELETE /v1/banners/{id}`

Removes the banner. Deleting is refused with `409` while other records still refer to it. Requires the `banners:write` scope.

### Example: create a banner

```http
POST /v1/banners
Authorization: Bearer <api key>
Idempotency-Key: ban-3242
Content-Type: application/json

{
  "title": "example title",
  "image_url": "example image url",
  "link_url": "example link url",
  "position": 206
}
```

The response repeats the banner as stored, with its `id` and both timestamps filled in.

### Errors for banners

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `banners:read` or `banners:write`. |
| `404` | `banners_not_found` | No banner has this identifier. |
| `409` | `banners_in_use` | The banner cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for banners

The shop emits `banners.created`, `banners.updated` and `banners.deleted`. A webhook subscribed to them receives the banner object as it was right after the change.

### Notes on banners

- Lists are read from the database replica. A banner created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted banner stays restorable from the admin panel for 30 days, then it is removed for good.

## Refunds

A refund returns money to the customer for all or part of a payment. Creating refunds is limited to 20 requests per minute per API key. This limit is separate from the general limit and cannot be raised.

### The refund object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `payment_id` | string | The payment id of the refund. |
| `amount_gross` | number | The amount gross of the refund. |
| `reason` | string | The reason of the refund. |
| `status` | string | The status of the refund. |
| `requested_at` | date-time | The requested at of the refund. |
| `completed_at` | date-time | The completed at of the refund. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ref_2023",
  "payment_id": "pay_1888",
  "amount_gross": 185,
  "reason": "example reason",
  "status": "example status",
  "requested_at": "2026-02-11T10:38:00Z",
  "completed_at": "2026-03-12T10:39:00Z",
  "created_at": "2026-04-13T10:40:00Z",
  "updated_at": "2026-05-14T10:41:00Z"
}
```

### List refunds

`GET /v1/refunds`

Returns a page of refunds, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `payment_id` | Only return records whose payment id matches exactly. |
| `sort` | `amount_gross` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `refunds:read` scope.

### Retrieve a refund

`GET /v1/refunds/{id}`

Returns one refund. Responds with `404` when the refund does not exist or the key has no access to it.

### Create a refund

`POST /v1/refunds`

Creates a refund. `payment_id` and `amount_gross` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second refund.

Responds with `201` and the new refund, or with `422` and a list of invalid fields. Requires the `refunds:write` scope.

### Update a refund

`PATCH /v1/refunds/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `payment_id`, `amount_gross`, `reason`, `status`. A request that sends an unknown field is refused with `422`.

### Delete a refund

`DELETE /v1/refunds/{id}`

Removes the refund. Deleting is refused with `409` while other records still refer to it. Requires the `refunds:write` scope.

### Example: create a refund

```http
POST /v1/refunds
Authorization: Bearer <api key>
Idempotency-Key: ref-3253
Content-Type: application/json

{
  "payment_id": "pay_1962",
  "amount_gross": 199,
  "reason": "example reason",
  "status": "example status"
}
```

The response repeats the refund as stored, with its `id` and both timestamps filled in.

### Errors for refunds

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `refunds:read` or `refunds:write`. |
| `404` | `refunds_not_found` | No refund has this identifier. |
| `409` | `refunds_in_use` | The refund cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for refunds

The shop emits `refunds.created`, `refunds.updated` and `refunds.deleted`. A webhook subscribed to them receives the refund object as it was right after the change.

### Notes on refunds

- Lists are read from the database replica. A refund created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted refund stays restorable from the admin panel for 30 days, then it is removed for good.

## Returns

A return tracks products a customer sends back.

### The return object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `order_id` | string | The order id of the return. |
| `reason` | string | The reason of the return. |
| `status` | string | The status of the return. |
| `received_at` | date-time | The received at of the return. |
| `restocked` | number | The restocked of the return. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "ret_2024",
  "order_id": "ord_1925",
  "reason": "example reason",
  "status": "example status",
  "received_at": "2026-02-11T10:38:00Z",
  "restocked": 213,
  "created_at": "2026-04-13T10:40:00Z",
  "updated_at": "2026-05-14T10:41:00Z"
}
```

### List returns

`GET /v1/returns`

Returns a page of returns, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `order_id` | Only return records whose order id matches exactly. |
| `sort` | `reason` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `returns:read` scope.

### Retrieve a return

`GET /v1/returns/{id}`

Returns one return. Responds with `404` when the return does not exist or the key has no access to it.

### Create a return

`POST /v1/returns`

Creates a return. `order_id` and `reason` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second return.

Responds with `201` and the new return, or with `422` and a list of invalid fields. Requires the `returns:write` scope.

### Update a return

`PATCH /v1/returns/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `order_id`, `reason`, `status`, `restocked`. A request that sends an unknown field is refused with `422`.

### Delete a return

`DELETE /v1/returns/{id}`

Removes the return. Deleting is refused with `409` while other records still refer to it. Requires the `returns:write` scope.

### Example: create a return

```http
POST /v1/returns
Authorization: Bearer <api key>
Idempotency-Key: ret-3264
Content-Type: application/json

{
  "order_id": "ord_1999",
  "reason": "example reason",
  "status": "example status",
  "restocked": 220
}
```

The response repeats the return as stored, with its `id` and both timestamps filled in.

### Errors for returns

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `returns:read` or `returns:write`. |
| `404` | `returns_not_found` | No return has this identifier. |
| `409` | `returns_in_use` | The return cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for returns

The shop emits `returns.created`, `returns.updated` and `returns.deleted`. A webhook subscribed to them receives the return object as it was right after the change.

### Notes on returns

- Lists are read from the database replica. A return created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted return stays restorable from the admin panel for 30 days, then it is removed for good.

## Invoices

An invoice is the accounting document issued for a paid order.

### The invoice object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `order_id` | string | The order id of the invoice. |
| `number` | string | The number of the invoice. |
| `total_gross` | number | The total gross of the invoice. |
| `issued_on` | date-time | The issued on of the invoice. |
| `pdf_url` | string | The pdf url of the invoice. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "inv_2025",
  "order_id": "ord_1962",
  "number": "example number",
  "total_gross": 206,
  "issued_on": "2026-03-12T10:39:00Z",
  "pdf_url": "example pdf url",
  "created_at": "2026-05-14T10:41:00Z",
  "updated_at": "2026-06-15T10:42:00Z"
}
```

### List invoices

`GET /v1/invoices`

Returns a page of invoices, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `order_id` | Only return records whose order id matches exactly. |
| `sort` | `number` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `invoices:read` scope.

### Retrieve a invoice

`GET /v1/invoices/{id}`

Returns one invoice. Responds with `404` when the invoice does not exist or the key has no access to it.

### Create a invoice

`POST /v1/invoices`

Creates a invoice. `order_id` and `number` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second invoice.

Responds with `201` and the new invoice, or with `422` and a list of invalid fields. Requires the `invoices:write` scope.

### Update a invoice

`PATCH /v1/invoices/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `order_id`, `number`, `total_gross`, `issued_on`, `pdf_url`. A request that sends an unknown field is refused with `422`.

### Delete a invoice

`DELETE /v1/invoices/{id}`

Removes the invoice. Deleting is refused with `409` while other records still refer to it. Requires the `invoices:write` scope.

### Example: create a invoice

```http
POST /v1/invoices
Authorization: Bearer <api key>
Idempotency-Key: inv-3275
Content-Type: application/json

{
  "order_id": "ord_2036",
  "number": "example number",
  "total_gross": 220,
  "issued_on": "2026-05-14T10:41:00Z"
}
```

The response repeats the invoice as stored, with its `id` and both timestamps filled in.

### Errors for invoices

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `invoices:read` or `invoices:write`. |
| `404` | `invoices_not_found` | No invoice has this identifier. |
| `409` | `invoices_in_use` | The invoice cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for invoices

The shop emits `invoices.created`, `invoices.updated` and `invoices.deleted`. A webhook subscribed to them receives the invoice object as it was right after the change.

### Notes on invoices

- Lists are read from the database replica. A invoice created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted invoice stays restorable from the admin panel for 30 days, then it is removed for good.

## Newsletter Subscribers

A newsletter subscriber is an address that agreed to receive the shop newsletter.

### The newsletter subscriber object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `email` | string | The email of the newsletter subscriber. |
| `confirmed` | boolean | The confirmed of the newsletter subscriber. |
| `source` | string | The source of the newsletter subscriber. |
| `subscribed_at` | date-time | The subscribed at of the newsletter subscriber. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "new_2026",
  "email": "example email",
  "confirmed": true,
  "source": "example source",
  "subscribed_at": "2026-04-13T10:40:00Z",
  "created_at": "2026-05-14T10:41:00Z",
  "updated_at": "2026-06-15T10:42:00Z"
}
```

### List newsletter-subscribers

`GET /v1/newsletter-subscribers`

Returns a page of newsletter-subscribers, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `email` | Only return records whose email matches exactly. |
| `sort` | `confirmed` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `newsletter-subscribers:read` scope.

### Retrieve a newsletter subscriber

`GET /v1/newsletter-subscribers/{id}`

Returns one newsletter subscriber. Responds with `404` when the newsletter subscriber does not exist or the key has no access to it.

### Create a newsletter subscriber

`POST /v1/newsletter-subscribers`

Creates a newsletter subscriber. `email` and `confirmed` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second newsletter subscriber.

Responds with `201` and the new newsletter subscriber, or with `422` and a list of invalid fields. Requires the `newsletter-subscribers:write` scope.

### Update a newsletter subscriber

`PATCH /v1/newsletter-subscribers/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `email`, `confirmed`, `source`. A request that sends an unknown field is refused with `422`.

### Delete a newsletter subscriber

`DELETE /v1/newsletter-subscribers/{id}`

Removes the newsletter subscriber. Deleting is refused with `409` while other records still refer to it. Requires the `newsletter-subscribers:write` scope.

### Example: create a newsletter subscriber

```http
POST /v1/newsletter-subscribers
Authorization: Bearer <api key>
Idempotency-Key: new-3286
Content-Type: application/json

{
  "email": "example email",
  "confirmed": true,
  "source": "example source"
}
```

The response repeats the newsletter subscriber as stored, with its `id` and both timestamps filled in.

### Errors for newsletter-subscribers

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `newsletter-subscribers:read` or `newsletter-subscribers:write`. |
| `404` | `newsletter_subscribers_not_found` | No newsletter subscriber has this identifier. |
| `409` | `newsletter_subscribers_in_use` | The newsletter subscriber cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for newsletter-subscribers

The shop emits `newsletter_subscribers.created`, `newsletter_subscribers.updated` and `newsletter_subscribers.deleted`. A webhook subscribed to them receives the newsletter subscriber object as it was right after the change.

### Notes on newsletter-subscribers

- Lists are read from the database replica. A newsletter subscriber created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted newsletter subscriber stays restorable from the admin panel for 30 days, then it is removed for good.

## Reports

A report is a generated summary, such as sales per day or stock below a threshold.

### The report object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `kind` | string | The kind of the report. |
| `period_from` | date-time | The period from of the report. |
| `period_to` | date-time | The period to of the report. |
| `status` | string | The status of the report. |
| `download_url` | string | The download url of the report. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "rep_2027",
  "kind": "example kind",
  "period_from": "2026-03-12T10:39:00Z",
  "period_to": "2026-04-13T10:40:00Z",
  "status": "example status",
  "download_url": "example download url",
  "created_at": "2026-07-16T10:43:00Z",
  "updated_at": "2026-08-17T10:44:00Z"
}
```

### List reports

`GET /v1/reports`

Returns a page of reports, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `kind` | Only return records whose kind matches exactly. |
| `sort` | `period_from` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `reports:read` scope.

### Retrieve a report

`GET /v1/reports/{id}`

Returns one report. Responds with `404` when the report does not exist or the key has no access to it.

### Create a report

`POST /v1/reports`

Creates a report. `kind` and `period_from` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second report.

Responds with `201` and the new report, or with `422` and a list of invalid fields. Requires the `reports:write` scope.

### Update a report

`PATCH /v1/reports/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `kind`, `period_from`, `period_to`, `status`, `download_url`. A request that sends an unknown field is refused with `422`.

### Delete a report

`DELETE /v1/reports/{id}`

Removes the report. Deleting is refused with `409` while other records still refer to it. Requires the `reports:write` scope.

### Example: create a report

```http
POST /v1/reports
Authorization: Bearer <api key>
Idempotency-Key: rep-3297
Content-Type: application/json

{
  "kind": "example kind",
  "period_from": "2026-05-14T10:41:00Z",
  "period_to": "2026-06-15T10:42:00Z",
  "status": "example status"
}
```

The response repeats the report as stored, with its `id` and both timestamps filled in.

### Errors for reports

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `reports:read` or `reports:write`. |
| `404` | `reports_not_found` | No report has this identifier. |
| `409` | `reports_in_use` | The report cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for reports

The shop emits `reports.created`, `reports.updated` and `reports.deleted`. A webhook subscribed to them receives the report object as it was right after the change.

### Notes on reports

- Lists are read from the database replica. A report created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted report stays restorable from the admin panel for 30 days, then it is removed for good.

## Webhooks

A webhook is an address the shop notifies when something happens, such as a paid order. A failed webhook delivery is retried 8 times with exponential backoff. The last attempt happens about 36 hours after the first, and after that the webhook is marked as failing.

### The webhook object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `url` | string | The url of the webhook. |
| `events` | array of strings | The events of the webhook. |
| `active` | boolean | The active of the webhook. |
| `last_delivery_at` | date-time | The last delivery at of the webhook. |
| `failures` | number | The failures of the webhook. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "web_2028",
  "url": "example url",
  "events": ["order.paid", "order.shipped"],
  "active": false,
  "last_delivery_at": "2026-06-15T10:42:00Z",
  "failures": 241,
  "created_at": "2026-08-17T10:44:00Z",
  "updated_at": "2026-09-18T10:45:00Z"
}
```

### List webhooks

`GET /v1/webhooks`

Returns a page of webhooks, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `url` | Only return records whose url matches exactly. |
| `sort` | `events` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `webhooks:read` scope.

### Retrieve a webhook

`GET /v1/webhooks/{id}`

Returns one webhook. Responds with `404` when the webhook does not exist or the key has no access to it.

### Create a webhook

`POST /v1/webhooks`

Creates a webhook. `url` and `events` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second webhook.

Responds with `201` and the new webhook, or with `422` and a list of invalid fields. Requires the `webhooks:write` scope.

### Update a webhook

`PATCH /v1/webhooks/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `url`, `events`, `active`, `failures`. A request that sends an unknown field is refused with `422`.

### Delete a webhook

`DELETE /v1/webhooks/{id}`

Removes the webhook. Deleting is refused with `409` while other records still refer to it. Requires the `webhooks:write` scope.

### Example: create a webhook

```http
POST /v1/webhooks
Authorization: Bearer <api key>
Idempotency-Key: web-3308
Content-Type: application/json

{
  "url": "example url",
  "events": ["order.paid", "order.shipped"],
  "active": false,
  "failures": 248
}
```

The response repeats the webhook as stored, with its `id` and both timestamps filled in.

### Errors for webhooks

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `webhooks:read` or `webhooks:write`. |
| `404` | `webhooks_not_found` | No webhook has this identifier. |
| `409` | `webhooks_in_use` | The webhook cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for webhooks

The shop emits `webhooks.created`, `webhooks.updated` and `webhooks.deleted`. A webhook subscribed to them receives the webhook object as it was right after the change.

### Notes on webhooks

- Lists are read from the database replica. A webhook created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted webhook stays restorable from the admin panel for 30 days, then it is removed for good.

## Api Keys

An API key identifies an integration that calls this API.

### The API key object

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Identifier, assigned by the shop. |
| `label` | string | The label of the API key. |
| `scopes` | array of strings | The scopes of the API key. |
| `last_used_at` | date-time | The last used at of the API key. |
| `expires_at` | date-time | The expires at of the API key. |
| `created_at` | date-time | When the record was created, in UTC. |
| `updated_at` | date-time | When the record last changed, in UTC. |

```json
{
  "id": "api_2029",
  "label": "example label",
  "scopes": ["order.paid", "order.shipped"],
  "last_used_at": "2026-06-15T10:42:00Z",
  "expires_at": "2026-07-16T10:43:00Z",
  "created_at": "2026-08-17T10:44:00Z",
  "updated_at": "2026-09-18T10:45:00Z"
}
```

### List api-keys

`GET /v1/api-keys`

Returns a page of api-keys, newest first. Use `limit` (up to 100, default 25) and `cursor` to page through the results. The response carries `next_cursor` when more records exist.

| Parameter | Description |
| --- | --- |
| `label` | Only return records whose label matches exactly. |
| `sort` | `scopes` or `created_at`, prefixed with `-` for descending order. |
| `updated_since` | Only return records changed after this moment. |

Requires the `api-keys:read` scope.

### Retrieve a API key

`GET /v1/api-keys/{id}`

Returns one API key. Responds with `404` when the API key does not exist or the key has no access to it.

### Create a API key

`POST /v1/api-keys`

Creates a API key. `label` and `scopes` are required. Send an `Idempotency-Key` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second API key.

Responds with `201` and the new API key, or with `422` and a list of invalid fields. Requires the `api-keys:write` scope.

### Update a API key

`PATCH /v1/api-keys/{id}`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: `label`, `scopes`. A request that sends an unknown field is refused with `422`.

### Delete a API key

`DELETE /v1/api-keys/{id}`

Removes the API key. Deleting is refused with `409` while other records still refer to it. Requires the `api-keys:write` scope.

### Example: create a API key

```http
POST /v1/api-keys
Authorization: Bearer <api key>
Idempotency-Key: api-3319
Content-Type: application/json

{
  "label": "example label",
  "scopes": ["order.paid", "order.shipped"]
}
```

The response repeats the API key as stored, with its `id` and both timestamps filled in.

### Errors for api-keys

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_json` | The body is not valid JSON. |
| `403` | `missing_scope` | The key lacks `api-keys:read` or `api-keys:write`. |
| `404` | `api_keys_not_found` | No API key has this identifier. |
| `409` | `api_keys_in_use` | The API key cannot be deleted while it is referred to. |
| `422` | `invalid_fields` | One or more fields failed validation; see `fields`. |

### Events for api-keys

The shop emits `api_keys.created`, `api_keys.updated` and `api_keys.deleted`. A webhook subscribed to them receives the API key object as it was right after the change.

### Notes on api-keys

- Lists are read from the database replica. A API key created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as `null`.
- A deleted API key stays restorable from the admin panel for 30 days, then it is removed for good.

## Changes to this API

Breaking changes get a new version prefix. Additions, such as new fields and endpoints, are made within version 1 and announced in the changelog.
