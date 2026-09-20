# API Documentation

REST + WebSocket API for the inminutes collaborative food ordering backend.

- **Base URL:** `http://localhost:3000/api`
- **Content type:** all request bodies are JSON; send `Content-Type: application/json`
- **WebSocket:** socket.io on the same origin (`http://localhost:3000`)

---

## Authentication — intentionally not implemented

**This prototype performs no authentication and no authorization.** There is no
login, no password, no token, no session cookie.

How identity works instead:

1. `POST /api/users` creates a user and returns its MongoDB `_id`.
2. The client stores that id and sends it back on every subsequent request —
   either as a URL path parameter (`/api/users/:userId/cart`) or as a `userId`
   field in the request body/query string.
3. The server **trusts that id completely**. It does not verify that the caller
   is actually that user.

This means anyone who knows a user's id can act as that user, and anyone who
knows a join code can read that group session. The only checks the server makes
are *membership* checks (is this userId the host / a participant of this
session?) — not *identity* checks.

Three endpoints are **host-only** in this sense —
[remove a participant](#remove-a-participant-host-only),
[place the group order](#place-group-order) and the
[host group order log](#host-group-order-log). Each compares the caller-supplied
id against the host recorded on the session or order. That reliably stops a
*participant* from acting as the host, which is the rule the group flow depends
on; it cannot stop someone who has the host's id outright.

This is a deliberate simplification to keep the prototype focused on the parts
the assignment is actually about: inventory correctness, concurrency, shared
group state, and real-time synchronization. A production version would add JWT
or session auth, derive `userId` from the verified token instead of the request
body, and reject requests where the authenticated user doesn't match the
resource being modified.

---

## Response conventions

| Status | Meaning | Body shape |
|--------|---------|------------|
| `200` | OK | `{ "data": ... }` |
| `201` | Created | `{ "data": ... }` (except `POST /api/users`, see below) |
| `400` | Invalid input | `{ "errors": [...] }` for body/query validation, `{ "mssg": "..." }` for a malformed id in the URL path |
| `403` | Not allowed | `{ "mssg": "..." }` |
| `404` | Not found | `{ "mssg": "..." }` |
| `409` | Conflict (out of stock, already joined, order already placed) | `{ "mssg": "..." }` |
| `500` | Unexpected server error | `{ "mssg": "..." }` |

`400` validation failures return the raw Zod issue list:

```json
{
  "errors": [
    {
      "expected": "string",
      "code": "invalid_type",
      "path": ["username"],
      "message": "Invalid input: expected string, received undefined"
    }
  ]
}
```

> **Two known inconsistencies** (carried over from the original code):
> `POST /api/users` returns its created user unwrapped (`{ id, name }`, not
> `{ data }`), and its `409`/`500` errors use an `error` key instead of `mssg`.

---

## Shared object shapes

### Product

```json
{
  "_id": "6aaea211429680111ea05a1c",
  "name": "Margherita Pizza",
  "price": 249,
  "qty": 25,
  "instock": true,
  "image_urls": [
    "https://res.cloudinary.com/demo/image/upload/c_fill,w_400,h_400,q_auto,f_auto/margherita-pizza.jpg",
    "https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,h_800,q_auto,f_auto/margherita-pizza.jpg"
  ],
  "__v": 0
}
```

`qty` is **currently available stock** (stock already reserved by someone's cart
is not included). `instock` is derived — it is always `qty > 0`.

`image_urls` is an ordered list of absolute media URLs: **`[0]` is the square
thumbnail** for list/grid views, **`[1]` is the full-size image** for the detail
view. Treat it as possibly empty — a deployment with no media storage configured
returns `[]`, so always guard with a placeholder. See
[Media storage](#media-storage-cloudinary).

### Group state

Returned by every group-session endpoint and pushed over the WebSocket. This is
the single object a client needs to render the whole group screen.

```json
{
  "join_code": "IB3F4F8J",
  "active": true,
  "host": {
    "user": { "_id": "6aaea21eb95b1a6bdbcb5429", "username": "alice01" },
    "display_name": "Alice"
  },
  "participants": [
    {
      "user": { "_id": "6aaea21eb95b1a6bdbcb542a", "username": "bobbob1" },
      "display_name": "Bob",
      "ready": false
    }
  ],
  "cart": [
    {
      "product": {
        "_id": "6aaea211429680111ea05a29",
        "name": "Gulab Jamun (2 pc)",
        "price": 69,
        "qty": 1,
        "instock": true,
        "image_urls": [
          "https://res.cloudinary.com/demo/image/upload/c_fill,w_400,h_400,q_auto,f_auto/gulab-jamun-2-pc.jpg",
          "https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,h_800,q_auto,f_auto/gulab-jamun-2-pc.jpg"
        ]
      },
      "qty": 2,
      "added_by": { "_id": "6aaea21eb95b1a6bdbcb542a", "username": "bobbob1" }
    },
    {
      "product": { "_id": "6aaea211429680111ea05a29", "name": "Gulab Jamun (2 pc)", "price": 69, "qty": 1, "instock": true },
      "qty": 1,
      "added_by": { "_id": "6aaea21eb95b1a6bdbcb5429", "username": "alice01" }
    }
  ]
}
```

> **The same product can appear more than once**, once per member who ordered
> it — above, Bob wants 2 and Alice wants 1, so 3 are on order. Group the array
> by `added_by` to show each person's basket, and sum by `product._id` for the
> quantity of a dish. `cart.length` is a count of *lines*, not of dishes.

> **The host has a `display_name` too.** `host` mirrors a participant entry
> (`{ user, display_name }`) minus `ready`, so a client can render the host row
> with the same component it uses for participants. The host is still *not* in
> the `participants` array.

> **Careful — two different `qty` fields.** Inside a cart entry,
> `cart[].qty` is *how many units are in the group cart*, while
> `cart[].product.qty` is *how much stock is still available to add*. Use
> `product.qty` / `product.instock` to decide whether to grey out an
> "add more" button.

### Order

```json
{
  "_id": "6aaea28d631672b777e74e77",
  "order_date": "2026-09-19T14:56:13.003Z",
  "order_amt": 138,
  "order_status": "placed",
  "order_type": "group",
  "order_by_user": "6aaea21eb95b1a6bdbcb5429",
  "grp_order": {
    "join_code": "IB3F4F8J",
    "host": "6aaea21eb95b1a6bdbcb5429",
    "host_display_name": "Alice",
    "grp_member": ["6aaea21eb95b1a6bdbcb542a", "6aaea21eb95b1a6bdbcb542b"],
    "members": [
      { "user": "6aaea21eb95b1a6bdbcb542a", "display_name": "Bob" },
      { "user": "6aaea21eb95b1a6bdbcb542b", "display_name": "Carol" }
    ]
  },
  "products": [
    {
      "product": "6aaea211429680111ea05a29",
      "name": "Gulab Jamun (2 pc)",
      "price": 69,
      "qty": 2,
      "added_by": "6aaea21eb95b1a6bdbcb542a",
      "added_by_name": "Bob",
      "_id": "6aaea28d631672b777e74e78"
    }
  ],
  "__v": 0
}
```

- `order_type` is `"normal"` or `"group"`.
- `grp_order` is only meaningful for group orders (for normal orders it comes
  back as `{ "grp_member": [], "members": [] }`).
- `products[]` has **one entry per cart line**, so a dish two people ordered
  appears twice, once for each of them. That is what makes the per-person
  breakdown possible.
- `products[]` is a **snapshot** — `name`, `price` and `added_by_name` are copied
  at order time so the order stays accurate even if the product changes, the
  session's display names change, or either is deleted later.
- `added_by` / `added_by_name` identify who put that line in the **group** cart.
  Normal orders have neither, since there is only one person involved.
- `grp_member` (ids) and `members` (ids **and** display names) hold the same
  people. `grp_member` is kept unchanged because orders already in the database
  store it in that shape; read `members` in new code.
- `order_status` is always `"placed"`; there is no status lifecycle in this MVP.

> **Orders placed before per-line attribution existed** have no `join_code`,
> `host_display_name`, `members` or `added_by`. They are still returned; the
> missing fields come back as `null` / `[]`. See
> [Host group order log](#host-group-order-log) for how the log handles them.

---

# Users

## Create user

`POST /api/users`

```json
{ "username": "alice01" }
```

| Field | Type | Rules |
|-------|------|-------|
| `username` | string | required, min 6 characters, must be unique |

**201 Created** — note the unwrapped shape:

```json
{ "id": "6aaea21eb95b1a6bdbcb5429", "name": "alice01" }
```

Save that `id` — it is how the client identifies itself on every other call.

**Errors:** `400` validation · `409` `{ "error": "Username already exists" }`

---

## List users

`GET /api/users`

**200 OK**

```json
{
  "data": [
    {
      "_id": "6aaea21eb95b1a6bdbcb5429",
      "username": "alice01",
      "cart": [],
      "order_placed": [],
      "__v": 0
    }
  ]
}
```

---

## Get user by id

`GET /api/users/:userId`

**200 OK** — `{ "data": { ...user } }`

**Errors:** `400` `{ "mssg": "Invalid user id" }` · `404` `{ "mssg": "User not found" }`

---

# Products

## List products

`GET /api/products`

**200 OK** — `{ "data": [ ...products ] }`

Returns every product, including out-of-stock ones (`qty: 0`, `instock: false`).
No pagination.

## Get product by id

`GET /api/products/:productId`

**200 OK** — `{ "data": { ...product } }`

**Errors:** `400` `{ "mssg": "Invalid product id" }` · `404` `{ "mssg": "Product not found" }`

---

# Media storage (Cloudinary)

Product images live in **Cloudinary**, not in this backend. The API stores and
hands out URLs only — there is no upload endpoint, and no image bytes ever pass
through the server. A client just renders `product.image_urls[n]` directly.

URLs are built from environment variables, so pointing the app at a different
Cloudinary account (or a CDN stub in CI) is a `.env` change, never a code change:

```
<CLOUDINARY_BASE_URL>/<CLOUDINARY_CLOUD_NAME>/image/upload/<transform>/[<CLOUDINARY_FOLDER>/]<product-slug>.<CLOUDINARY_IMAGE_FORMAT>
```

The `<CLOUDINARY_FOLDER>/` segment is only inserted when that variable is
non-empty (see the folder note below).

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLOUDINARY_CLOUD_NAME` | *(empty)* | Cloudinary account. **Empty disables images entirely** — `image_urls` comes back `[]`. |
| `CLOUDINARY_BASE_URL` | `https://res.cloudinary.com` | delivery host; override to point at a custom domain or a local stub |
| `CLOUDINARY_FOLDER` | *(empty)* | see below — leave empty unless your account needs it |
| `CLOUDINARY_IMAGE_FORMAT` | `jpg` | file extension in the URL |
| `CLOUDINARY_THUMB_TRANSFORM` | `c_fill,w_400,h_400,q_auto,f_auto` | transform for `image_urls[0]` (square thumbnail) |
| `CLOUDINARY_FULL_TRANSFORM` | `c_fill,w_1200,h_800,q_auto,f_auto` | transform for `image_urls[1]` (detail view) |

The `<product-slug>` is derived from the product name — lowercased with every
run of non-alphanumeric characters collapsed to a single `-`. So
`"Gulab Jamun (2 pc)"` becomes `gulab-jamun-2-pc`, and the asset must be stored
in Cloudinary under that public id.

`npm run seed` generates these URLs and reports how many products got them:

```
Seeded 17 products (17 with image URLs)
```

> **About `CLOUDINARY_FOLDER` — leave it empty unless you know you need it.**
> Most Cloudinary accounts now default to **Dynamic Folders**, where the folder
> shown in the console is display metadata only — it is *not* part of the
> asset's `public_id`. Uploading an image into a `products/` folder in the
> console still delivers at `.../image/upload/<transform>/<product-slug>.jpg`,
> with no folder segment; including one in the URL 404s. Only set
> `CLOUDINARY_FOLDER` if your account uses the older Fixed/Rigid folder mode,
> where the folder really is baked into the `public_id`. If in doubt, upload
> one asset, open it in the console, and check its **public_id** field — that's
> the exact string this code needs to reproduce.

> `.env.example` ships with `CLOUDINARY_CLOUD_NAME` empty, so a fresh checkout
> has no images until you point it at a real account. Once you upload an asset
> under the public id matching a product's slug, its URL resolves immediately —
> no code change or redeploy needed. Until then (or for any product you haven't
> uploaded yet), that URL 404s, so clients must handle a broken image the same
> way they handle an empty `image_urls`.

---

# Normal cart

The personal cart used for non-group ordering. **Adding to the cart immediately
reserves stock** — it is not reserved at checkout. See
[README](README.md#inventory-model) for why.

## Get cart

`GET /api/users/:userId/cart`

**200 OK** — cart entries with the product **populated**:

```json
{
  "data": [
    {
      "_id": "6aaea251bec1032d360964d9",
      "product": {
        "_id": "6aaea211429680111ea05a1c",
        "name": "Margherita Pizza",
        "price": 249,
        "qty": 23,
        "instock": true,
        "image_urls": [
          "https://res.cloudinary.com/demo/image/upload/c_fill,w_400,h_400,q_auto,f_auto/margherita-pizza.jpg",
          "https://res.cloudinary.com/demo/image/upload/c_fill,w_1200,h_800,q_auto,f_auto/margherita-pizza.jpg"
        ],
        "__v": 0
      },
      "qty": 2
    }
  ]
}
```

> The personal cart populates the **whole** product document, so entries here
> carry `image_urls` and `__v`. The [group cart](#group-cart) populates a
> trimmed projection of the same product instead.

**Errors:** `400` invalid id · `404` user not found

---

## Add item to cart

`POST /api/users/:userId/cart`

```json
{ "productId": "6aaea211429680111ea05a1c", "qty": 2 }
```

| Field | Type | Rules |
|-------|------|-------|
| `productId` | string | required, 24-char hex ObjectId |
| `qty` | number | required, integer, min 1 |

**201 Created** — the updated cart, product **not** populated here:

```json
{
  "data": [
    { "product": "6aaea211429680111ea05a1c", "qty": 2, "_id": "6aaea251bec1032d360964d9" }
  ]
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| `400` | `{ "errors": [...] }` | bad/missing `productId` or `qty` |
| `404` | `{ "mssg": "User not found" }` | unknown user |
| `409` | `{ "mssg": "Product already in cart, use PATCH to update quantity" }` | product is already a line in this cart |
| `409` | `{ "mssg": "Insufficient stock" }` | fewer than `qty` units available |

---

## Update cart item quantity

`PATCH /api/users/:userId/cart/:productId`

```json
{ "qty": 5 }
```

`qty` is the **absolute new quantity**, not a delta. The server reserves or
releases the difference automatically (going from 2 to 5 reserves 3 more; going
from 5 to 1 releases 4).

**200 OK** — the single updated cart entry:

```json
{ "data": { "product": "6aaea211429680111ea05a1c", "qty": 5, "_id": "6aaea251bec1032d360964d9" } }
```

**Errors:** `400` validation/invalid id · `404` `{ "mssg": "User not found" }` ·
`404` `{ "mssg": "Product not in cart" }` · `409` `{ "mssg": "Insufficient stock" }`

To remove an item, use `DELETE` — `qty: 0` is rejected by validation.

---

## Remove cart item

`DELETE /api/users/:userId/cart/:productId`

No request body. Releases all stock reserved by that line.

**200 OK** — the remaining cart: `{ "data": [] }`

**Errors:** `400` invalid id · `404` user not found · `404` `{ "mssg": "Product not in cart" }`

---

# Normal orders

## Place order

`POST /api/users/:userId/orders`

No request body — the order is built from whatever is currently in the user's
cart. Stock was already reserved when items were added, so placing the order
does not change `Product.qty`; it snapshots the cart into an Order and empties
the cart.

**201 Created** — `{ "data": { ...order } }` with `order_type: "normal"`.

**Errors:** `400` invalid id · `400` `{ "mssg": "Cart is empty" }` · `404` user not found

---

## Get order history

`GET /api/users/:userId/orders`

**200 OK** — `{ "data": [ ...orders ] }`, newest first. Includes both normal
orders the user placed and group orders they hosted or participated in.

**Errors:** `400` invalid id · `404` user not found

---

## Host group order log

`GET /api/users/:userId/group-orders`

Every group order this user **hosted**, newest first, with a per-person
breakdown of who ordered what.

**What "host only" means here.** The filter *is* the restriction: an order is
only ever returned to the user recorded as its host. A participant calling this
for their own id gets back the sessions they ran, never the ones they merely
joined — those stay in their normal
[order history](#get-order-history). Since there is no auth
([by design](#authentication--intentionally-not-implemented)), anyone who knows
a host's id can read that host's log; the server cannot tell callers apart. What
it *can* guarantee is that being a participant never gets you the host's view.

**200 OK**

```json
{
  "data": [
    {
      "_id": "6aaf21798e44fb57fca1b336",
      "order_date": "2026-09-19T23:57:45.681Z",
      "order_amt": 597,
      "order_status": "placed",
      "join_code": "XBN1454R",
      "host": {
        "user": { "_id": "6aaf...306", "username": "alice01" },
        "display_name": "Alice"
      },
      "members": [
        { "user": { "_id": "6aaf...307", "username": "bobbob1" }, "display_name": "Bob" },
        { "user": { "_id": "6aaf...308", "username": "carol01" }, "display_name": "Carol" }
      ],
      "products": [
        {
          "product": "6aaf...488",
          "name": "Margherita Pizza",
          "price": 249,
          "qty": 2,
          "line_amt": 498,
          "added_by": { "_id": "6aaf...307", "username": "bobbob1" },
          "added_by_name": "Bob"
        },
        {
          "product": "6aaf...48a",
          "name": "Veg Burger",
          "price": 99,
          "qty": 1,
          "line_amt": 99,
          "added_by": { "_id": "6aaf...306", "username": "alice01" },
          "added_by_name": "Alice"
        }
      ],
      "breakdown": [
        { "user": { "_id": "6aaf...306", "username": "alice01" }, "display_name": "Alice", "lines": 1, "qty": 1, "amount": 99 },
        { "user": { "_id": "6aaf...307", "username": "bobbob1" }, "display_name": "Bob", "lines": 1, "qty": 2, "amount": 498 },
        { "user": { "_id": "6aaf...308", "username": "carol01" }, "display_name": "Carol", "lines": 0, "qty": 0, "amount": 0 }
      ]
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `join_code` | the session this order came out of |
| `host` | `{ user, display_name }` — same shape as in [group state](#group-state) |
| `members` | the participants, with the display names they used in that session |
| `products[].line_amt` | `price × qty`, precomputed |
| `products[].added_by` | who put this line in the shared cart (populated user) |
| `breakdown` | one row per person — **what each of them owes** |

**About `breakdown`.** This is the point of the log: it answers "who owes what"
without the client having to group the lines itself.

- The **host is included**, because the host can add to the shared cart too.
- **Members who ordered nothing are included** with `lines: 0, amount: 0`, so
  nobody silently disappears from the split.
- `amount` values **sum to `order_amt`**.
- Orders placed before per-line attribution existed have nothing to attribute,
  so their lines collect in a single extra row with
  `"user": null, "display_name": null`. That row keeps the sum property true.

Group orders only — normal orders never appear here, whatever the user's role.

**Errors:** `400` `{ "mssg": "Invalid user id" }` · `404` `{ "mssg": "User not found" }`

A user who has never hosted a group order gets `200` with `{ "data": [] }`, not
a `404`.

---

# Group sessions

## Create session

`POST /api/group-sessions`

```json
{ "userId": "6aaea21eb95b1a6bdbcb5429", "display_name": "Alice" }
```

| Field | Type | Rules |
|-------|------|-------|
| `userId` | string | required, 24-char hex ObjectId |
| `display_name` | string | **optional**, 1–30 characters — the name the group sees for the host. Defaults to the host's `username` when omitted. |

The caller becomes the **host**. A unique 8-character uppercase-alphanumeric
join code is generated.

**201 Created**

```json
{ "join_code": "IB3F4F8J", "host_display_name": "Alice" }
```

**Errors:** `400` validation · `404` `{ "mssg": "User not found" }`

---

## Get session state

`GET /api/group-sessions/:joinCode`

**200 OK** — `{ "data": { ...group state } }`. Works for inactive (already
ordered) sessions too, so a client can still display a completed order.

**Errors:** `404` `{ "mssg": "Group session not found" }`

---

## Join session

`POST /api/group-sessions/:joinCode/join`

```json
{ "userId": "6aaea21eb95b1a6bdbcb542a", "display_name": "Bob" }
```

| Field | Type | Rules |
|-------|------|-------|
| `userId` | string | required, 24-char hex ObjectId |
| `display_name` | string | required, 1–30 characters, unique within the session — **including the host's own display name** |

New participants always start with `ready: false`.

**200 OK** — `{ "data": { ...group state } }`. Also broadcasts `group:state` to
everyone already connected to the session.

**Errors:**

| Status | Body | When |
|--------|------|------|
| `400` | `{ "errors": [...] }` | bad/missing `userId` or `display_name` |
| `404` | `{ "mssg": "User not found" }` | unknown user |
| `404` | `{ "mssg": "Active group session not found" }` | bad join code, or the order was already placed |
| `409` | `{ "mssg": "Host cannot join their own group as a participant" }` | host tried to join their own session |
| `409` | `{ "mssg": "User has already joined this group session" }` | duplicate join |
| `409` | `{ "mssg": "Display name already exists in this group" }` | display name already used by a participant **or by the host** |

---

## Get participants

`GET /api/group-sessions/:joinCode/participants`

**200 OK** — just the `participants` array from the group state.

**Errors:** `404` `{ "mssg": "Group session not found" }`

---

## Set ready status

`PATCH /api/group-sessions/:joinCode/participants/:userId/ready`

```json
{ "ready": true }
```

| Field | Type | Rules |
|-------|------|-------|
| `ready` | boolean | required |

A client is expected to only call this with its own `userId` — there is no auth
to enforce it (see [Authentication](#authentication--intentionally-not-implemented)).

**The host has no ready status.** The host can never be a participant, so
"everyone is ready" only ever refers to the `participants` array.

**200 OK** — `{ "data": { ...group state } }`, broadcast to the session.

**Errors:** `400` invalid id or non-boolean `ready` · `404` `{ "mssg": "Active group session not found" }` ·
`404` `{ "mssg": "User is not a participant of this session" }`

---

## Remove a participant (host only)

`DELETE /api/group-sessions/:joinCode/participants/:participantId?userId=<hostId>`

Kicks a member out of the session. Only the **host** may call this.

| Parameter | In | Rules |
|-----------|-----|-------|
| `participantId` | path | the participant being removed, 24-char hex ObjectId |
| `userId` | query | the caller — must be the session's host |

**What happens to their cart items.** Every group-cart line that participant
added is removed, and the stock it was holding is released back to the product.
A kicked member therefore never leaves stock locked up in a cart they can no
longer edit. Lines other members added are untouched — `added_by` records who
first added a line and is never reassigned, including when someone else changes
the quantity with `PATCH`, so a kick only ever drops lines that member actually
added.

Removing an un-ready participant also unblocks
[placing the order](#place-group-order) — "everyone is ready" is evaluated over
whoever is still in the session.

**200 OK** — `{ "data": { ...group state } }`.

Two WebSocket events go out to the room, in order:

1. `group:participant_removed` — `{ join_code, user, display_name }`, so the
   removed member's client can show "you were removed" and leave the screen.
2. `group:state` — the refreshed state for everyone else.

**Errors:**

| Status | Body | When |
|--------|------|------|
| `400` | `{ "mssg": "Invalid user id" }` | `participantId` is not a valid ObjectId |
| `400` | `{ "errors": [...] }` | missing/malformed `userId` query parameter |
| `400` | `{ "mssg": "Host cannot be removed from the session" }` | host passed their own id as `participantId` |
| `403` | `{ "mssg": "Only the host can remove a participant" }` | caller is not the host |
| `404` | `{ "mssg": "Active group session not found" }` | bad join code, or the order was already placed |
| `404` | `{ "mssg": "User is not a participant of this session" }` | that user is not (or is no longer) in the session |

A removed member can simply join again with the same join code — nothing bans
them. Closing a session to a kicked member would need auth, which this prototype
deliberately does not have.

---

# Group cart

The shared cart. Any member of the session (host or participant) may add items
and change or remove **their own** lines, and every change is broadcast to all
connected clients.

Because the URL has no `:userId` segment, the caller's id travels in the **body**
for `POST`/`PATCH` and in the **query string** for `DELETE`.

**One cart entry per product _per member_.** Two people ordering the same dish
each get their own line, so the cart records *who wants how many* rather than a
single shared number. The total ordered for a product is the sum of its lines.

A second `POST` for a product **you** already added is rejected — use `PATCH` to
change your own quantity. A `POST` for a product someone *else* added is
accepted and creates your line beside theirs.

`PATCH` and `DELETE` only ever touch the caller's own line: `added_by` is set
when the line is created and never moves, so nobody can edit or remove what
another member ordered.

## Get group cart

`GET /api/group-sessions/:joinCode/cart`

**200 OK** — just the `cart` array from the group state.

**Errors:** `404` `{ "mssg": "Group session not found" }`

---

## Add item to group cart

`POST /api/group-sessions/:joinCode/cart`

```json
{
  "userId": "6aaea21eb95b1a6bdbcb542a",
  "productId": "6aaea211429680111ea05a29",
  "qty": 2
}
```

| Field | Type | Rules |
|-------|------|-------|
| `userId` | string | required, must be the host or a participant |
| `productId` | string | required, 24-char hex ObjectId |
| `qty` | number | required, integer, min 1 |

**201 Created** — `{ "data": { ...group state } }`, broadcast to the session.

**Errors:**

| Status | Body | When |
|--------|------|------|
| `400` | `{ "errors": [...] }` | validation failure |
| `403` | `{ "mssg": "User is not part of this group session" }` | caller is neither host nor participant |
| `404` | `{ "mssg": "Active group session not found" }` | bad code, or order already placed |
| `409` | `{ "mssg": "You already added this item, use PATCH to change your quantity" }` | **you** already have a line for this product — someone else having one is fine |
| `409` | `{ "mssg": "Insufficient stock" }` | fewer than `qty` units available |

---

## Update group cart item

`PATCH /api/group-sessions/:joinCode/cart/:productId`

```json
{ "userId": "6aaea21eb95b1a6bdbcb542a", "qty": 3 }
```

`qty` is the absolute new quantity **of the caller's own line**; the difference
is reserved or released automatically. `added_by` is never changed, and a member
cannot change a line somebody else added — that returns `404`.

**200 OK** — `{ "data": { ...group state } }`, broadcast to the session.

**Errors:** `400` validation · `403` not a member · `404` active session not found ·
`404` `{ "mssg": "You have not added this item to the group cart" }` ·
`409` `{ "mssg": "Insufficient stock" }`

---

## Remove group cart item

`DELETE /api/group-sessions/:joinCode/cart/:productId?userId=<userId>`

The caller's id goes in the **query string**, not the body. Removes **the
caller's own line** for that product and releases the stock it held, making it
immediately available to everyone else. Other members' lines for the same
product are untouched.

**200 OK** — `{ "data": { ...group state } }`, broadcast to the session.

**Errors:** `400` missing/invalid `userId` query param · `403` not a member ·
`404` active session not found ·
`404` `{ "mssg": "You have not added this item to the group cart" }`

---

## Place group order

`POST /api/group-sessions/:joinCode/order`

```json
{ "userId": "6aaea21eb95b1a6bdbcb5429" }
```

Only the **host** may call this, and all of the following must hold:

1. The session is still `active` (no order placed yet).
2. There is at least one participant.
3. The group cart is not empty.
4. Every participant has `ready: true`.

On success the session is flipped to `active: false` in a single atomic
operation, so two simultaneous requests cannot both create an order. An Order is
created with a snapshot of the cart, and its id is added to the order history of
the host and every participant.

The snapshot also records **who added each line** (`added_by` / `added_by_name`)
and the session's `join_code`, display names included, which is what makes the
[host group order log](#host-group-order-log) work after the session is closed.

**201 Created** — `{ "data": { ...order } }` with `order_type: "group"`. A final
`group:state` (now `active: false`) is broadcast to the session.

**Errors:**

| Status | Body | When |
|--------|------|------|
| `400` | `{ "errors": [...] }` | bad/missing `userId` |
| `400` | `{ "mssg": "Cannot place an order with no participants" }` | nobody joined |
| `400` | `{ "mssg": "Group cart is empty" }` | nothing to order |
| `403` | `{ "mssg": "Only the host can place the group order" }` | caller is not the host |
| `404` | `{ "mssg": "Group session not found" }` | bad join code |
| `409` | `{ "mssg": "All participants must be ready before placing the order" }` | someone is not ready |
| `409` | `{ "mssg": "Group order has already been placed for this session" }` | session already inactive, or lost the race to a simultaneous request |

Once inactive, the session rejects joins, ready toggles, and all cart changes.

---

# WebSocket API

Real-time synchronization uses **socket.io**, served on the same port as the
REST API (`http://localhost:3000`).

Sockets are **broadcast-only**: clients never mutate state over the socket. All
writes go through the REST endpoints above; the socket exists purely to push the
resulting state to everyone else. This keeps validation in one place.

## Client to server

| Event | Payload | Purpose |
|-------|---------|---------|
| `group:join` | `"IB3F4F8J"` (join code string) | subscribe to that session's updates |
| `group:leave` | `"IB3F4F8J"` | unsubscribe |

```js
const socket = io("http://localhost:3000");

socket.on("connect", () => {
  socket.emit("group:join", "IB3F4F8J");
});
```

## Server to client

| Event | Payload |
|-------|---------|
| `group:state` | the full [group state](#group-state) object |
| `group:participant_removed` | `{ join_code, user, display_name }` |

```js
socket.on("group:state", (state) => {
  // replace local state wholesale — no diffing needed
});
```

`group:state` is emitted to every socket subscribed to that join code after
**any** of these succeed:

- a participant joins
- an item is added to the group cart
- a group cart quantity changes (increase or decrease)
- an item is removed from the group cart
- a participant toggles ready / not ready
- the host removes a participant
- the host places the group order (final broadcast, `active: false`)

Apart from `group:participant_removed` there are no fine-grained events
(`cart:item_added` etc.) by design — the client simply replaces its local state
with each `group:state` it receives.

### `group:participant_removed`

The one exception, because being kicked is not something a client can infer from
the new state alone (it just sees itself missing). It fires immediately before
the `group:state` that reflects the removal:

```js
socket.on("group:participant_removed", ({ user, display_name }) => {
  if (user === myUserId) {
    // you were removed — leave the group screen
  } else {
    // someone else was removed — optional toast; the group:state that
    // follows already has them gone
  }
});
```

**Stock updates come through here too.** Because each cart entry embeds the
product's live `qty`/`instock`, a client watching a session sees availability
change the moment anyone else reserves or releases stock.

---

# Quick end-to-end example

```bash
BASE=http://localhost:3000/api

# 1. Create users
HOST=$(curl -s -X POST $BASE/users -H 'Content-Type: application/json' \
  -d '{"username":"alice01"}' | jq -r .id)
GUEST=$(curl -s -X POST $BASE/users -H 'Content-Type: application/json' \
  -d '{"username":"bobbob1"}' | jq -r .id)

# 2. Pick a product
PRODUCT=$(curl -s $BASE/products | jq -r '.data[0]._id')

# 3. Host opens a group session, choosing the name the group sees
CODE=$(curl -s -X POST $BASE/group-sessions -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$HOST\",\"display_name\":\"Alice\"}" | jq -r .join_code)

# 4. Guest joins
curl -s -X POST $BASE/group-sessions/$CODE/join -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$GUEST\",\"display_name\":\"Bob\"}"

# 5. Guest adds an item to the shared cart
curl -s -X POST $BASE/group-sessions/$CODE/cart -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$GUEST\",\"productId\":\"$PRODUCT\",\"qty\":2}"

# 6. Guest marks ready
curl -s -X PATCH $BASE/group-sessions/$CODE/participants/$GUEST/ready \
  -H 'Content-Type: application/json' -d '{"ready":true}'

# 7. Host places the order
curl -s -X POST $BASE/group-sessions/$CODE/order -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$HOST\"}"

# (Before step 7, the host could instead kick the guest out — their cart lines
#  are dropped and the stock they held is released back to the product.)
# curl -s -X DELETE "$BASE/group-sessions/$CODE/participants/$GUEST?userId=$HOST"

# 8. Host reviews their group order log — who ordered what, and who owes what
curl -s $BASE/users/$HOST/group-orders | jq '.data[0].breakdown'

# The guest hosted nothing, so their log is empty (they see the order in
# GET /users/$GUEST/orders instead)
curl -s $BASE/users/$GUEST/group-orders | jq '.data'
```

A ready-made Postman collection covering every endpoint above is in
[postman_collection.json](postman_collection.json) — it chains ids between
requests automatically.
