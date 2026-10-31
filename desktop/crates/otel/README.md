# muse-spark-otel

OpenTelemetry wiring for Muse Desktop's Rust surfaces (M111 lane OB,
PLAN.md D91.22). The shell, the compositor and their siblings send
metrics, logs and traces to the node's local OTLP/HTTP receiver, which
keeps them on the box in its ring store.

One call wires everything:

```rust
let guard = muse_spark_otel::init("http://127.0.0.1:4318", "shell")?;
// ... instrument with `tracing` (via guard.span_layer() and
// guard.logs_layer()) or the global tracer and meter ...
guard.shutdown()?;
```

Rules the crate enforces:

- The endpoint must be plain `http` on a loopback host with no path;
  anything else is refused. Telemetry never leaves the box from here —
  export to the person's own collector is the runtime exporter's
  business, over TLS, only after they switch it on.
- The component must be one of the receiver's `O11Y_COMPONENTS`.
- Call `init` once per process, inside a multi-thread Tokio runtime;
  shut the guard down once before the runtime goes away.

Rust panics become structured crash records through
`install_panic_hook`, in the ring's own day-file line shape. The record
carries shape only — component, `panic` kind and code, time, and the
panic's file, line and column. The payload is never read.

## Proof

- `cargo test`: unit tests (endpoint and component refusals, the
  day stamp against `date` oracles, the frame-path rule, a caught
  panic writing one record) plus an integration test posting all
  three signals to a real HTTP capture server and checking the
  OTLP/HTTP JSON bodies.
- `cargo clippy --all-targets` (all + pedantic denied) and
  `cargo fmt --check`.
- The wiring test refreshes the node's receiver fixtures when
  `OTLP_FIXTURE_DIR` points at an empty directory; the recorded
  exchange lives at
  `test/unit/o11y/fixtures/otlp-rust-2026-10-31/` with its capture
  note, and the receiver suite ingests it for real.

No CI builds Rust yet; until the release lane wires it, this crate is
proven by local runs recorded in `docs/certification/rlf-m111ob.md`.
