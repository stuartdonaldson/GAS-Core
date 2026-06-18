## 2026-06-18 08:32:34

### Summary:
Re-architected the libs/ test & demo harness instead of executing batch 4. After
flagging the existing approach as overly complex/expensive, pivoted the design
across three iterations to a final HYBRID model and re-scoped all tracking:

- **Dropped the shared integration aggregator** (examples/integrated/test-harness/)
  and its demo-vendoring machinery. Deleted scripts/copy-demo-files.sh +
  pairs-file.txt; reverted scripts/check-lib-drift.sh to its production-only
  version (the production-consumer anti-fork drift check is retained).
- **Adopted the hybrid model:** the deployable unit is a *demo* composing 1+
  libraries; demo logic co-locates in libs/<Name>/<name>Demo.js (a <LIB>_DEMOS
  manifest of named global functions) so a contributor adding a feature touches
  only libs/<Name>/. A shared examples/demo-harness/ wrapper provides
  Harness.getSheet() + onOpen menu + doGet; examples/demos/<demo>/demo.config.json
  declares {host, uses[]}; scripts/push-demo.sh assembles wrapper + uses[] libs
  and clasp-pushes to reusable hosts (scriptIds in libs/harness-hosts.json).
- **Rewrote docs/test-harness-design.md** to the hybrid (banner + §2/§4.0/§4.1/
  §4.3/§8/§9), marking aggregator sections superseded.
- **bd:** closed pos.6 (obsolete); created GAS-Core-sou (tool+wrapper) and
  GAS-Core-xnc (extract demos out of vendored libSheets.js); re-scoped
  pos.2/7/8/9/10; recorded 3 memories (authoritative:
  test-demo-harness-hybrid-model-2026-06-18). Created batch:8-demo-foundation
  (xnc+sou+7p5, model:sonnet), unblocked sou from pos.2 — ready to dispatch.

### Key Learnings:
- GAS V8 loads every file in a clasp project into ONE shared global scope with
  no require() — this single fact drove the entire pivot (it forced the
  aggregator's HARNESS_DEMOS_ namespacing + demo vendoring + drift policing).
- GAS menu items bind only to a NAMED zero-arg global function, never to an
  anonymous closure. The aggregator stored demos as entryPoint:(ctx)=>{} closures
  in a data array, so its per-feature menu click was a non-functional no-op. Fix:
  the demo manifest references the function by name string (demo:'libSheets_fn')
  and the function pulls its environment from a Harness accessor (zero-arg, bindable).
- clasp push overwrites a project's content, so a host project is a reusable
  "slot" — assemble the chosen demo at push time and nothing committed can drift
  (no vendoring, no drift check for demos).
- libSheets.js (the VENDORED production file) currently embeds demo functions
  (~lines 43-144) that ship to every consumer — extracting them (GAS-Core-xnc)
  is both the demo seed and a production-hygiene fix.
