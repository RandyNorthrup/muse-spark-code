# OTLP/HTTP JSON as the Rust client sends it

Captured 2026-10-31 on linuxlt. One request body per signal, exactly as
`muse-spark-otel`'s exporters POSTed it (OTLP/HTTP JSON to a loopback
capture server), feeding the node's receiver suite: the exchange proves
the Rust client's bytes are bytes the TypeScript ingest accepts.

Capture command (from the repository root; `cargo` on `PATH`):

```sh
OTLP_FIXTURE_DIR=test/unit/o11y/fixtures/otlp-rust-2026-10-31 \
  cargo test -p muse-spark-otel --test wiring
```

(`OTLP_FIXTURE_DIR` is the wiring test's fixture refresh: off by
default, one body per signal when set. The crate lives at
`desktop/crates/otel`; with no workspace yet, run it from that
directory instead of `-p`.)

The exchange: one `tracing` span (`render`) with an error event, one
manual error span (`failing`), one counter (`frames`), one error log
record (`frame dropped`), all for component `shell`. Trace and span
ids and timestamps differ every capture; the suite asserts shapes and
names, never the random parts.
