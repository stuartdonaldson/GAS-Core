# GAS Web-App Response Delivery: Lost and Late Responses (Known Issue)

**Status:** accepted environmental issue. It is a platform behaviour with no fix on our side; it can
only be absorbed. Seen in three projects: GActionSheet (first, 2026), F3Go30 (browser → web app,
ADR-022 / F3Go30-313u), NUUTS-Shell + NUUTS-Format (test client → web app and GAS → GAS relay,
nuuts-56x / nuuts-32h).

## Symptom

A call to an Apps Script web app (`doGet`/`doPost` on `/exec`) that normally answers in 1–3 s
intermittently:

- **arrives late**: the body comes back after 20–120 s, or
- **is lost**: after 3–75 s the caller gets `404 Page Not Found` (a Google HTML page, often reported
  as "non-JSON response"), or a `302` back to `script.google.com/macros/s/<deployment>/…` that a
  redirect-following client turns into a `doGet`.

In both cases **the handler already ran**. Server logs show it finishing in under 1.5 s while the
caller is still waiting.

## Mechanism

Every web-app call is two legs:

1. `POST|GET /exec` runs the handler and returns `302` to
   `script.googleusercontent.com/macros/echo?user_content_key=…`.
2. The caller `GET`s that echo URL to receive the body.

Leg 1 succeeds. Leg 2 is what stalls or fails. Once an echo URL has failed it never serves the body
on a later `GET` (NUUTS probe: up to 6 GET-only retries, 0 recoveries). The only recovery is a new
leg 1, which **runs the handler again**.

`google.script.run` from an `HtmlService` dialog or sidebar appears to use a different channel and is
not known to be affected (not measured).

## Measured frequency (NUUTS-Shell TEST, 2026-10-02/03)

Three full live suites, about 2,000 calls:

| | Calls | Share |
|---|---|---|
| Lost (echo 404 / redirect) | 7 | 0.35% |
| Late, answered after more than 20 s | 10 | 0.5% |
| Normal call: median 1.6 s, 95th percentile about 3 s, 99th percentile about 9 s | | |

From nuuts-56x probes (NUUTS-Format): idle, 0 failures in 220 calls. Under suite load, 0.3–0.6% of
direct calls failed. GAS → GAS (`UrlFetchApp` relay/registration): 1 of 16 and 3 of 14 in two runs.

### Patterns

1. **Bursts.** Events cluster in windows of minutes. One run had 14 events in 20 minutes; the next
   run 30 minutes later had 2. One NUUTS-Format run lost every response for several minutes (28
   losses).
2. **Not route-specific.** A near-empty handler (`deleteScriptProperty`) is hit at the same rate as
   complex ones, so the counts follow call volume. Handler work is not the trigger.
3. **Load-correlated.** No failures were seen while idle. It is not known whether the trigger is the
   caller's own load or Google-side load.
4. **GAS → GAS is worse** than an external client → GAS. Cause unknown.
5. **A fresh request outside a burst usually succeeds quickly.** In 6 of 7 NUUTS losses the re-POST
   answered in 1.5–2.4 s; the seventh took 13 s.

## What does not help

- Raising client timeouts (losses happen well before any timeout).
- Retrying the same echo URL with `GET` only (the fix in prospect-os PR #3; it does not recover here).
- Persistent connections or streaming. Apps Script has no keep-alive and no flush (F3Go30 ADR-022).
- Changing logging or handler code. The handler and the Axiom flush finish in under 0.5 s of each
  other.

## Remediation

| # | Remediation | Absorbs | Status / cost |
|---|---|---|---|
| R1 | **Make every retried call safe to re-run.** Prefer naturally idempotent handlers. Otherwise use a request id plus a replay cache: the callee stores the response in `CacheService` under `replay:<id>`, and a repeated id returns the cached response without re-running the handler. | Required before R2/R3 on any non-idempotent action | Implemented in NUUTS (remote-feature-contract rev 1.5a §7.4) |
| R2 | **Treat a lost response as retryable.** Use `followRedirects:false` and collect the two legs yourself. Classify echo 404, a non-JSON echo body, or an echo redirect to `script.google.com` as *lost*, then re-send leg 1 with the same id, bounded (NUUTS: 5 attempts, 2–3 s apart). | Isolated losses | Implemented (NUUTS harness + relay; F3Go30-313u browser client) |
| R3 | **Cut a late echo leg and re-send.** Time out the *echo* leg (not leg 1, which includes handler time) at a fixed threshold well above its normal tail, then go to R2. Use a percentile-based threshold, not mean + 2σ: the stalls inflate σ (NUUTS: σ = 3.9 s including stalls, 1.3 s without), so a σ-based threshold moves with the thing it is meant to detect. | Isolated late responses; turns a 20–120 s stall into about 10–15 s | **Proposed.** It needs per-leg timing to set the threshold. It is only possible where the client controls timeouts: Python/Node, or browser `fetch` with `AbortController`. **Not** possible from GAS, because `UrlFetchApp` has no timeout. |
| R4 | **Fewer round trips.** Batch operations into one call, run independent calls in parallel, and cache on the client. | Reduces exposure in proportion | F3Go30 ADR-015 / ADR-022 |
| R5 | **Apps Script API `scripts.run`** for GAS → GAS calls. It returns JSON directly with no echo leg. | GAS → GAS loss, including bursts | Not pursued. Requires a shared standard GCP project and an API-executable deployment; the call runs as the caller, not the deployer. |
| R6 | **Move server-to-server endpoints to Cloud Run.** | Removes the echo leg for the moved endpoints | Not pursued. Billing, IAM, CORS and a second deploy target (F3Go30 ADR-022). Editor add-on UI (menus, dialogs, run-as-user) cannot move. |

**No remediation absorbs a multi-minute burst** within an interactive or per-test time budget. For
tests: count late time against the test's time budget, and accept a run that fails only because of
a logged burst as environmental red (NUUTS owner decision 2026-10-03, nuuts-32h). For production:
surface "try again" to the user.

## Diagnostic recipe

1. Capture the failing call's leg-1 status, its echo URL and the echo result: a HAR in the browser,
   or a two-leg client with `followRedirects:false`.
2. Correlate it with server logs by run or op id. A handler completion logged before the caller's
   failure confirms this issue; stop debugging application code.
3. Record the call (route, attempts, lost seconds) so the rate can be tracked
   (NUUTS: `test-results/duration-log.jsonl`).

## Sources

- NUUTS-Shell `nuuts-56x.md` (root-cause evidence, probes, remediation R1/R2), beads nuuts-56x and
  nuuts-32h. Data: NUUTS-Shell `test-results/duration-log.jsonl`.
- F3Go30 `adr/022-gas-exec-redirect-latency-cloud-run-reconsidered.md`; F3Go30-313u
  (`test_client_transport_resilience.js`).
- GActionSheet `knowledge-base/references/gas-webapp-echo-fetch-transient-404.md` (first occurrence,
  HAR diagnostic).
- External: [prospect-os PR #3](https://github.com/markkrizsan/prospect-os/pull/3);
  [Make Community thread](https://community.make.com/t/intermittent-404-from-google-apps-script-via-http-same-request-succeeds-on-retry/116204);
  [Understanding Flow of Request to Web Apps](https://medium.com/google-cloud/understanding-flow-of-request-to-web-apps-created-by-google-apps-script-ac49e80f7c6b).
  No Google acknowledgement or issue-tracker entry found (searched 2026-10-03).
