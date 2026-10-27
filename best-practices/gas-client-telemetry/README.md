# Best Practice: Client Telemetry (browser errors delivered to the server log until acked)

> **This is a standard, copied verbatim.** `client-telemetry.js` goes unchanged into a page's own
> `<script>` block; `ClientTelemetryLog.js` goes unchanged into the GAS source. Everything
> project-specific is configuration (storage key, `context()`, the carrier action). Change the files
> **here** and re-copy. Origin: F3Go30 (`script/ClientTelemetryLog.js` and the queue in
> `static-pages/src/index.html`); PracticeMix is the first adopter of this shared module. Moving
> F3Go30 onto it is a separate F3Go30 task.

## Why

A failure that happens in the browser before a request reaches Apps Script ("Could not reach the
server", a timeout, a JS crash) never appears in the server log, because the server never saw it.
This pattern queues those errors in the browser and delivers them later, **removing a record only
when the server acknowledges it**.

## Pattern

1. `capture`/`captureError` append a record to a bounded queue (25 records, 7 days) persisted in
   storage, or in memory when storage is unavailable.
2. **Piggyback:** before each ordinary request, `attach(payload)` adds up to 5 records (2048 bytes) as
   `payload.telemetry.records`. The server logs them and answers `telemetryAck: [ids]`. `settle()`
   dequeues exactly those ids, including from `ok:false` responses.
3. **Background flush:** if the queue is non-empty and nothing has carried it for 30 s, `flush()` sends
   a dedicated batch of up to 10 through `send()`. Backoff is 30/60/120/300 s (capped), reset by any
   ack of one of the ids that send carried (an ack of none of them counts as a failure, not a reset). Also at page load and on the `online` event.
4. **Beacon:** on `visibilitychange` hidden / `pagehide`, `flushOnHide()` beacons the newest 10 records
   not yet beaconed (each record id is beaconed at most once per page session, kept in memory; a failed
   beacon does not mark the id; the set is cleared when the page becomes visible again, so a hide after a return re-beacons). A beacon has no response, so it never dequeues; the server dedupes the
   later re-send by id. When the beacon accepts a record it is stamped `beaconedAt` (client ms) and persisted with it; at instance creation, records whose `beaconedAt` is older than the 6 h server dedupe window (`TELEMETRY_BEACON_DEDUPE_TTL_MS_`, exported; mirrors `CLIENT_TELEMETRY_DEDUPE_TTL_SECONDS_` in `ClientTelemetryLog.js`) are dropped unsent, because the server could no longer dedupe them. Younger ones are re-sent normally. Both channels.
5. A transport failure calls `release()` (nothing dequeued). A failed flush **never captures a
   record**, otherwise a dead network would feed itself.

## Channels: error and activity

`createClientTelemetry(deps)` takes `deps.channel`: `'error'` (the default, everything above) or
`'activity'` (navigation/playback events). Each channel is its own instance with its own storage
key and queue, so activity can never evict errors. An instance created without `deps.channel`
behaves exactly as before and stamps no `channel` field; an instance given `deps.channel` stamps
`channel: 'error'|'activity'` on every record (a `channel` key in `context()`/`fields` cannot
override it).

| Limit (`deps.limits` key) | error | activity |
|---|---|---|
| Queue records (`queueMax`), oldest dropped | 25 | 200 |
| Queue age (`maxAgeMs`) | 7 days | 7 days |
| Piggyback records (`attachMax`) | 5 | 10 |
| Piggyback bytes (`attachMaxBytes`) | 2048 | 2048 |
| Dedicated send / beacon batch (`flushBatchMax`) | 10 | 25 |

Any positive number in `deps.limits` overrides that default. Keep each instance's `attachMax` and
the sum of both instances' `attachMax` within the server batch cap (25); anything beyond it is not
logged or acked and stays queued.

**Idle persist (activity).** `capture()` appends to the in-memory queue and returns: no storage
read, no JSON of the whole queue, no storage write on the calling tick (only the record itself is
round-tripped through JSON). The queue is read from storage once, when the instance is created. A
change schedules one persist, coalescing every capture until it runs: `deps.requestIdleCallback`,
else the global `requestIdleCallback`, called with `{ timeout: 2000 }`; else `deps.setTimeout(fn,
2000)`. The 7-day prune runs at persist time; the 200 cap at capture. `flushOnHide()` persists
first, then beacons. Two tabs on one activity key are last-writer-wins (the error channel re-reads
storage on every call and is not).

**Low-rate flush (activity).** A dedicated activity send goes only when all hold:

- no carrier request carried activity, and no activity send started, in the last 60 s;
- at least 20 records are unsent, or the oldest unsent record is at least 5 min old;
- any failure backoff has elapsed: the n-th consecutive failure waits 30/60/120/300 s (capped),
  so under the 60 s floor the effective retries are 60/60/120/300 s. An ack of one of this
  instance's carried ids (piggyback or send) resets it; a response that acks none of them counts as a failure.

`flush()` (page load) and the `online` event run this check; they never force a send. One timer is
armed for the moment the check will next pass. `installGlobalHandlers(window)` on an activity
instance registers only `online`, `pagehide` and `visibilitychange` (no error capture).

**One carrier, two instances.** Call `attach(payload)` on both instances before `fetch`. Each
appends to `payload.telemetry.records` without touching records the other attached, within **its
own** budget (error <=5 / 2048 bytes plus activity <=10 / 2048 bytes: at most 15 records). The error
instance puts its records first and the activity instance appends, so error records lead whatever
the call order. `settle(carried, body)` / `release(carried)` are per instance with that instance's
own `carried` ids; each dequeues only its own acked ids from the shared `telemetryAck`.

## Record shape

`{ id, at, kind, source, msg (<=500), stack (<=1200), pageSession, clientVersion, online, ...context(), ...fields }`

- `at` is the client time the error occurred (the server's `ts` is delivery time).
- `pageSession` is one id per page load. `kind` becomes the server tag `client.<kind>`.
- No key may be one GasLogger stamps: `version`, `env`, `op`, `parentOp`, `ts`, `tag`. The client
  renames any such key to `client_<key>` and the server does the same defensively.
- Never put credentials (session tokens) in `context()` or `fields`.

## Ack protocol

| Direction | Shape |
|---|---|
| Piggyback request | ordinary action payload + `telemetry: { records: [...] }` |
| Dedicated request | `{ action: 'clientTelemetry', records: [...] }` (records at top level) |
| Response | ordinary body + `telemetryAck: [ids]` (logged **or** already seen) |

A response without `telemetryAck` (old server, crash) acks nothing; `settle()` releases the records
and a flush is scheduled. The server acks even when the carrier action is denied or unknown. `settle()` or a dedicated send whose `telemetryAck` contains none of the ids this instance carried counts as a backoff failure (30/60/120/300 s), so a record the server never acks is retried with backoff. `settle()` writes storage only when at least one record was removed.

## Server (`ClientTelemetryLog.js`)

- `logPiggybackedClientTelemetry_(payload, context, opts)` returns ack ids, `null` when nothing was
  carried, `[]` on failure. `handleClientTelemetryPost_(payload, context, opts)` handles the dedicated
  action. `attachTelemetryAck_(response, ids)` merges the ack. None of them throws.
- Records are untrusted. Before the context is merged the server strips client-supplied who keys
  (`email`, `sub`, `visitor`, `anon`, `ip`; matched case-insensitively) and skips the keys `__proto__`,
  `constructor` and `prototype`, so only `context` supplies them, and clips: `msg` 500, `stack` 1200, any other string field 500, any non-string value whose
  JSON exceeds 500 chars is replaced by that JSON clipped to 500, at most 40 keys per record
  (`id`/`kind` kept first). A client key that collides with a GasLogger-stamped key is renamed
  `client_<key>`; the renamed value wins over a client key literally named `client_<key>`.
- Batch capped at 25 (the rest stay queued client-side). Dedupe by `id` in `CacheService` for 6 h.
- **Fail-safe logging: the server never rejects a record.** Every record with an id is logged once and
  acked. The only non-ack path is a log call that throws: that record is retried. (A record without
  an id cannot be acked and is skipped, as before.)
- Tag mapping (`kind` valid when it matches `/^[a-zA-Z]{1,32}$/`):

  | `channel` | valid kind | invalid kind |
  |---|---|---|
  | absent, `null`, `'error'` | `client.<kind>` | `client.unknown` + `clientKind` |
  | `'activity'` | `<activityPrefix><kind>` | `<activityPrefix>unknown` + `clientKind` |
  | anything else | `client.<kind>` + `clientChannel` | `client.unknown` + `clientKind` + `clientChannel` |

  `opts.activityPrefix` defaults to `'client.activity.'`. `clientKind` / `clientChannel` hold the raw
  value (a string as is, anything else as its JSON, `undefined` as `'undefined'`) clipped to 64.
- `opts.validate(kind, rec)` (optional) is called with the raw kind and record for every not-yet-seen
  record of either channel. A non-empty array of field names adds `schemaMismatch` (names joined with
  `,`, clipped to 500). It never prevents logging; a throwing validator or a non-array result adds
  nothing. Server-set `clientKind`, `clientChannel` and `schemaMismatch` overwrite same-named keys.
- Activity records get the same dedupe, who-key stripping and clipping as errors.
- `context` is stamped on every logged record: pass your who-fields (visitor, ip, email only when a
  session verified). `opts.log` / `opts.cache` are test seams; defaults are `GasLogger.log` and
  `CacheService.getScriptCache()`. All three entry points take the same `opts`, so pass
  `{ activityPrefix, validate }` to each of them.

## Adoption

1. Copy `ClientTelemetryLog.js` into the GAS source. Copy `client-telemetry.js` into its own
   `<script>` block, before the block that defines your request function.
2. Create one instance: `createClientTelemetry({ storage, key: '<app>.telemetry.<target>', now, newId,
   setTimeout, clearTimeout, context, send, beacon, clientVersion, isOnline })`.
3. In the request function: mint a request id, `carried = attach(payload)` just before `fetch`; on a
   thrown fetch `release(carried)` + `captureError(...)` and mark nothing else; on a parsed body
   `settle(carried, body)`.
4. `send(records)` for the dedicated flush POSTs `{action:'clientTelemetry', records}` **without**
   `attach` and without capturing on failure. `beacon(records)` uses `navigator.sendBeacon` with a
   `text/plain` body to the same URL.
5. `installGlobalHandlers(window)`, then `flush()` once at page load.
   Activity (optional): a second instance `createClientTelemetry({ channel: 'activity', key:
   '<app>.activity.<target>', ...same deps })`; in the request function `attach` and later
   `settle`/`release` it alongside the error instance with its own `carried` ids; call its
   `installGlobalHandlers(window)` and `flush()` too. Capture with `activity.capture('<kind>',
   '<source>', fields)`.
6. Server: ingest `payload.telemetry.records` on **every** action (unknown/denied included), merge
   `telemetryAck` into the response, and route the `clientTelemetry` action before any identity gate.
7. Log the request id (`rid`) on the server's per-call row to join client records to server rows.

## Per-project configuration

Storage key, `context()` fields, the carrier action name, how `send`/`beacon` reach the endpoint, and
which sources you `capture`. Nothing in the two files changes.

## Tests

```
node --test best-practices/gas-client-telemetry/test_client_telemetry.js \
            best-practices/gas-client-telemetry/test_client_telemetry_log.js
```

(These are not in the root `npm run test:unit` glob, like `gas-server-logging/test_gas_logger.js`.)
