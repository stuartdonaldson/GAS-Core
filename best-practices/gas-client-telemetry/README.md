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
   ack. Also at page load and on the `online` event.
4. **Beacon:** on `visibilitychange` hidden / `pagehide`, `flushOnHide()` beacons the newest 10 records
   not yet beaconed (each record id is beaconed at most once per page session, kept in memory; a failed
   beacon does not mark the id; the set is cleared when the page becomes visible again, so a hide after a return re-beacons). A beacon has no response, so it never dequeues; the server dedupes the
   later re-send by id.
5. A transport failure calls `release()` (nothing dequeued). A failed flush **never captures a
   record**, otherwise a dead network would feed itself.

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
and a flush is scheduled. The server acks even when the carrier action is denied or unknown.

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
- Batch capped at 25. Dedupe by `id` in `CacheService` for 6 h. A kind not matching
  `/^[a-zA-Z]{1,32}$/` is tagged `client.unknown`.
- `context` is stamped on every logged record: pass your who-fields (visitor, ip, email only when a
  session verified). `opts.log` / `opts.cache` are test seams; defaults are `GasLogger.log` and
  `CacheService.getScriptCache()`.

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
