# inminutes_backend

Backend for a collaborative food ordering app. Users can order on their own, or
open a **group session** where several people share one cart in real time —
adding items, seeing each other's changes live, marking themselves ready, and
having the host check out for everyone.

Built with Express, MongoDB and socket.io. Designed to be consumed by a Flutter
client (built separately).

---

## What it does

**Normal ordering**

- Browse products, each with image URLs served from Cloudinary
- Add items to a personal cart, change quantities, remove items
- Place an order and view order history

**Group ordering**

- A host opens a session, picks the display name the group sees, and gets a
  short join code
- Others join with that code and a display name of their own
- Everyone shares one cart, and every item records who added it — if two people
  order the same dish, each keeps their own line, so you can see who wants what
- Changes made by one person appear on everyone else's device instantly
- Each participant marks themselves Ready / Not Ready
- The host can remove a participant, which also frees the stock that member was
  holding in the shared cart
- The host can only check out once every participant is Ready
- Placing the order closes the session
- The host gets a log of every group order they hosted, broken down by who
  ordered what and what each person owes

**Inventory, throughout**

- Stock is reserved the moment something enters a cart, not at checkout
- Removing or reducing an item puts the stock back for everyone else
- Two people can never reserve the same last unit — stock cannot go negative

---

## Tech stack

| | |
|---|---|
| Runtime | Node.js 22 |
| Web framework | Express 5 |
| Database | MongoDB 8 (via Mongoose 9) |
| Real-time | socket.io 4 |
| Validation | Zod 4 |
| Auth | none — see [below](#authentication) |

---

## Getting started

### Option A — run locally

Requires Node.js 22+ and a MongoDB instance on `localhost:27017`.

Match `MONGO_URI` to how that instance is configured: a MongoDB started without
authentication takes `mongodb://localhost:27017/inminutes`, while one with a
root user needs the credentials and `?authSource=admin` as below. Sending a
credentialed URI to a no-auth server fails with `Authentication failed`, and
vice versa.

```bash
npm install
npm run seed     # loads ~17 demo food products
npm run dev      # nodemon, restarts on change
```

The API is then at `http://localhost:3000/api`.

Configuration lives in `.env` — copy [.env.example](.env.example) and fill it in:

```
MONGO_URI=mongodb://rootuser:rootpassword@localhost:27017/inminutes?authSource=admin

# Media storage — product image URLs are built from these
CLOUDINARY_CLOUD_NAME=demo
CLOUDINARY_BASE_URL=https://res.cloudinary.com
CLOUDINARY_FOLDER=inminutes/products
```

Leave `CLOUDINARY_CLOUD_NAME` empty to run without images — products then come
back with `image_urls: []`. See [Media storage](#media-storage) below.

### Option B — run with Docker

Brings up the API and its own MongoDB together. Create a `.env.docker` file
first — inside the Compose network the database is reached by service name
(`mongo`), not `localhost`. `docker-compose.yaml` hands this file to **both**
containers, so the Mongo root user is also set from here, via
`MONGO_INITDB_ROOT_USERNAME`/`PASSWORD` — the exact names the official `mongo`
image's entrypoint reads to create that user on its first start. The app
itself only ever reads `MONGO_URI`; keep the two in step:

```
MONGO_INITDB_ROOT_USERNAME=rootuser
MONGO_INITDB_ROOT_PASSWORD=rootpassword
MONGO_URI=mongodb://rootuser:rootpassword@mongo:27017/inminutes?authSource=admin

CLOUDINARY_CLOUD_NAME=demo
CLOUDINARY_BASE_URL=https://res.cloudinary.com
CLOUDINARY_FOLDER=inminutes/products
```

Mongo only creates that root user the **first** time it starts against an empty
data directory, so if you ever bring this up without the two `MONGO_INITDB_*`
keys, fix the file and then `docker compose down && docker volume rm
inminutes_db` before starting again — restarting alone will not retroactively
create the user.

Then:

```bash
docker compose up --build
docker compose exec backend npm run seed   # seed products into the container's DB
```

The API is published on `http://localhost:3000`, and MongoDB on
`localhost:27017` if you want to inspect it with `mongosh` or Compass.

### npm scripts

| Script | Does |
|--------|------|
| `npm start` | run the server |
| `npm run dev` | run with nodemon (auto-restart) |
| `npm run seed` | wipe and reseed the products collection |
| `npm run watch-group -- <joinCode>` | dev tool: print live WebSocket updates for a session |

---

## Project structure

```
index.js                 Express app, HTTP server, socket.io bootstrap
schemas/schema.js        Mongoose schemas (User, Order, Product, GroupSession)
models/models.js         Models built from those schemas
controllers/             Request handlers
  usercontrollers.js
  productcontrollers.js
  cartcontrollers.js     personal cart
  ordercontrollers.js    normal order placement, history, host group order log
  groupcontrollers.js    group session, group cart, group checkout
routes/                  Express routers, mounted under /api
validators/validators.js Zod schemas for every request
utils/utils.js           stock reservation, group state shaping, join codes,
                         Cloudinary image URL building
sockets/socket.js        socket.io setup and room handling
seed/seed.js             demo product data
scripts/watch-group.js   dev tool for watching live WebSocket broadcasts

Dockerfile               production image (node:22-alpine, prod deps only)
docker-compose.yaml      API + MongoDB 8, on an external network and volume
.env / .env.docker       local and in-container config (git-ignored)
.env.example             annotated template for both
```

Every request follows the same path, with no service or repository layer in
between:

```
Route  ->  Controller  ->  validate (Zod)  ->  MongoDB  ->  JSON response
```

---

## How it works

### Inventory model

`Product.qty` is the amount **currently available to reserve**. It drops as soon
as an item enters a cart — personal or group — and goes back up the moment that
item is reduced or removed. Checkout does not touch stock at all; it just turns
the already-reserved cart into an order.

This is what makes the live "sold out" behaviour work: if one person takes the
last unit, everyone else is blocked from adding it immediately, not at checkout.
`Product.instock` is a convenience flag that is always kept equal to `qty > 0`.

### Concurrency

The risky moment is two people reserving the last unit at the same time. Rather
than locking, every stock change is a **single conditional MongoDB update**:

```js
Product.findOneAndUpdate(
  { _id: productId, qty: { $gte: qty } },     // only matches if enough stock
  [{ $set: { qty: { $subtract: ["$qty", qty] } } },
   { $set: { instock: { $gt: ["$qty", 0] } } }],
  { new: true, updatePipeline: true }
)
```

MongoDB guarantees single-document updates are atomic, so of two simultaneous
requests only the first can match the `qty >= requested` condition. The second
matches nothing, gets `null`, and is answered with `409 Insufficient stock`.
Stock can never go negative.

Duplicate group checkout is prevented the same way — flipping the session's
`active` flag from `true` to `false` is itself the atomic claim, so only one of
several simultaneous "place order" requests can win.

The database here runs as a standalone instance, so multi-document transactions
are not available; the atomic-single-document approach is the deliberate
substitute.

**The known gap.** Each stock change is atomic *in itself*, but it is a separate
write from the cart change that follows it — `reserveStock()` and then
`cart.push()` + `save()` are two operations, not one. If the process dies
between them, the two can drift: stock reserved but no cart line to show for it
(a unit quietly unavailable), or stock released while its line survives (the
same unit released twice on a retry). A transaction would close this, which
needs a replica set. Nothing in the flow lets stock go *negative* — that is the
guarantee the single-document update actually buys — so the failure mode is
drift, not oversell.

### Media storage

Product images live in **Cloudinary**; this backend stores and hands out URLs
only. There is no upload endpoint and no image bytes pass through the server —
clients render `product.image_urls[n]` straight from the CDN.

Every URL is assembled from environment variables, so switching Cloudinary
accounts (or pointing at a stub in CI) is a `.env` change rather than a code
change:

```
<CLOUDINARY_BASE_URL>/<CLOUD_NAME>/image/upload/<transform>/[<FOLDER>/]<product-slug>.<FORMAT>
```

`image_urls[0]` is the square thumbnail for list views and `image_urls[1]` is
the larger detail image; the two differ only by the transform segment. The slug
comes from the product name (`"Gulab Jamun (2 pc)"` → `gulab-jamun-2-pc`), which
must also be the asset's `public_id` in Cloudinary.

**`CLOUDINARY_FOLDER` defaults to empty, and that's usually correct.** Most
Cloudinary accounts default to Dynamic Folders, where the folder shown in the
console is organizational metadata only, not part of the `public_id` — so
delivery URLs need no folder segment even if you uploaded into a folder there.
Only set `CLOUDINARY_FOLDER` if your account uses the older Fixed/Rigid folder
mode, where the folder really is baked into the `public_id`. If unsure, upload
one asset and check its `public_id` in the console.

`npm run seed` generates the URLs. With `CLOUDINARY_CLOUD_NAME` unset it seeds
products with an empty `image_urls` and says so, so the app runs fine without
media configured. Point it at a real account, upload each asset under the
public id matching a product's slug, and the URL resolves immediately, no
redeploy needed. Any product you haven't uploaded yet 404s — clients should
handle that the same way they handle an empty `image_urls`.

The full variable list is in
[apidocs.md](apidocs.md#media-storage-cloudinary).

### Real-time sync

Clients open a socket.io connection and subscribe to a session by emitting
`group:join` with its join code, which puts them in a room named after that
code.

They never write over the socket. Every group change goes through a normal REST
call; once the database is updated, the server reads the fresh session state and
broadcasts it to that room as a single `group:state` event:

```
REST mutation -> MongoDB write -> read fresh state -> emit group:state to the room
```

Clients replace their local state with whatever arrives. One event type, no
diffing, and validation lives in exactly one place.

The single exception is `group:participant_removed`, emitted just before the
`group:state` for a kick. A removed client cannot tell from the new state alone
that it was kicked — it only sees itself missing — so it gets told explicitly.

### Host group order log

`GET /api/users/:userId/group-orders` returns every group order that user
hosted, newest first, with a `breakdown` of what each person owes.

Two things make this work:

**The order snapshots who added what.** When the host checks out, each line
copies the `added_by` user *and* the display name they were using, alongside the
`name`/`price` copy the order already made. Display names belong to a session
whose lifetime is not the order's, so — same reasoning as product name and price
— they are snapshotted rather than looked up later. The `join_code` is stored
too, so an order can still be traced back to its session.

**"Host only" is the query, not a check.** An order is only ever returned to the
user recorded as its host, so a participant asking for their own log gets the
sessions they ran and never the ones they merely joined. Those still appear in
their ordinary order history. With no auth the server cannot tell callers apart,
so anyone holding a host's id can read that host's log — but no amount of being
a *participant* gets you the host's view.

The breakdown includes the host (who can add to the cart too) and members who
ordered nothing (as a zero row, so nobody vanishes from the split), and its
amounts sum to the order total. Group orders placed before per-line attribution
existed still return — their lines collect in a single unattributed row, which
keeps that sum property true.

### Group session rules

- The host is never a participant and therefore has no Ready flag — "everyone is
  ready" refers only to the people who joined. The host does still have a
  display name, stored next to the host reference rather than in the
  participants list, so every member on screen has a name
- A user cannot join the same session twice, and display names must be unique
  within a session — the host's name counts, so a joiner cannot impersonate them
- The host can remove any participant. Everything that member put in the shared
  cart goes with them and its reserved stock is released, so a kicked member
  never leaves stock locked up in a cart they can no longer edit. Removing an
  un-ready member also unblocks checkout
- Being removed is not a ban — with no auth there is nothing to enforce one, and
  the member can rejoin with the same code
- Only members (host or participants) can change the shared cart
- The shared cart holds one entry per product **per member**, so two people
  ordering the same dish each keep their own line and quantity; `added_by` is
  set when the line is created and never moves, and members can only edit or
  remove their own lines
- Only the host can check out, and only with at least one participant, a
  non-empty cart, and everyone ready
- Once the order is placed the session is closed, and further joins, cart
  changes, ready toggles and checkouts are all rejected

---

## Authentication

**There is none, on purpose.** Creating a user returns an id; the client sends
that id back on later requests and the server trusts it. There are no passwords,
tokens or sessions.

The server still enforces *membership* rules — only the host can check out, only
session members can touch the shared cart — but it never verifies that a caller
really is the user id they claim.

This keeps the prototype focused on what the project is actually about:
inventory correctness, concurrency, shared state and real-time sync. Adding JWT
or session auth later means taking `userId` from a verified token instead of the
request body; the rest of the logic stays as it is.

---

## Testing

There is no automated test suite. Three ways to exercise the API by hand:

**Postman** — import [postman_collection.json](postman_collection.json). It is
split into Users & Products, Normal order flow and Group order flow; run a
folder top to bottom and ids are chained between requests automatically. Two
requests in the group folder are off the happy path and marked as such: kicking
a participant, and removing a group cart item.

**curl** — see the end-to-end script at the bottom of
[apidocs.md](apidocs.md#quick-end-to-end-example).

**Watching real-time updates** — in one terminal:

```bash
npm run watch-group -- <joinCode>
```

Then drive the session from Postman or curl in another terminal and watch each
`group:state` broadcast print as it arrives. It prints
`group:participant_removed` too, so a kick shows up as both the notification and
the state that follows it.

To check the concurrency guarantee, fire several simultaneous requests at a
product with one unit left and confirm that exactly one succeeds and stock
settles at `0`:

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3000/api/group-sessions/<code>/cart \
    -H 'Content-Type: application/json' \
    -d '{"userId":"<id>","productId":"<low-stock-id>","qty":1}' &
done
wait
```

The seed data deliberately includes high-stock, low-stock and zero-stock items
to make these cases easy to hit.

---

## Documentation

| File | Contents |
|------|----------|
| [apidocs.md](apidocs.md) | Full REST and WebSocket reference — every endpoint, request body, response shape and error |
| [postman_collection.json](postman_collection.json) | Importable Postman collection covering all flows |
| [.env.example](.env.example) | Every environment variable, annotated |

Architecture and the reasoning behind the design decisions are in
[How it works](#how-it-works) above rather than a separate document.

---

## Deliberately left out

This is a prototype, so the following are knowingly absent rather than
overlooked:

- Authentication and authorization (see above)
- Order status lifecycle — every order is created as `placed` and stays there
- Payments
- Pagination on list endpoints
- Rate limiting
- Automated tests
- Product management endpoints (products come from the seed script)
- Image uploads — product images are URLs pointing at Cloudinary, populated by
  the seed script; nothing is uploaded through the API
