---
paths:
  - "src/adapters/**"
---

# Adapters

- Follow `docs/adapter-guide.md` and PADR-0007: pinned app version, declared attribute set with
  reasoned exclusions, apply only through official interfaces, read back and integrity-check
  after every write; an API success code alone is never success.
- Derived geometry the app does not update on programmatic writes (Excalidraw: arrow endpoints,
  label centring) is computed by the adapter and covered by conformance tests.
- Conformance tests run against the real pinned app, at least three repetitions, with a wrong
  prediction and an invalid transition as negative cases.
- Recording starts only on explicit request; unknown changes are logged as `unmodeled`.
- Never bundle third-party assets (fonts, images) without their licence texts.
