# Threat model — RLM110B phase t: questionnaire and toolchain packs (TQ, TP1, TP2, TA, TV, TJ)

Reviewed 2026-10-22 by the lane author before any phase-t code was written;
lead review pending at integration. Scope: the first-run questionnaire (TQ),
the signed pack index and builds (TP1), pack install (TP2), agent awareness
(TA), guided install on the person's machine (TV), and the judge scan and
setup (TJ). D90.27 governs; D121/D208 forbid any limit of ours.

## Assets

- The person's machine and workspaces (packs install toolchains with native code).
- Supply chain: every byte a pack installs must trace to a pinned upstream source.
- The person's choice: nothing installs, updates, or is removed without their click.
- Licence honesty: click-through and non-free licences stay the person's own act.

## Trust boundaries

- Upstream tool sources (npm, PyPI, crates, release binaries, SDK vendors).
- The pack index and layers (built in CI, cosign-signed).
- Repository code: pack contents never execute at install time on the host;
  layers compose sandbox images only.
- The person's own machine (TV): the extension guides, never installs by itself.

## Threats and mitigations

| #   | Threat                                                                                           | Mitigation                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | A tampered or downgraded pack index installs old/vulnerable tools.                               | cosign-signed index with no-downgrade and expiry; every artifact pinned by digest; refusal names the mismatch.                                                                                               |
| T2  | A pack layer's contents differ from its manifest.                                                | Digest-checked fetch with resume and SHA-256; SBOM per layer; vulnerability scan in the pack CI.                                                                                                             |
| T3  | Two packs (or a pack and the project's lockfile) conflict and break the toolchain silently.      | Compatibility check before install (declared constraints, e.g. TypeScript 6.0.x for typescript-eslint, dpdm not madge); conflicts refuse naming both sides; nothing passes `--legacy-peer-deps` or its like. |
| T4  | A silent or agent-driven install.                                                                | Nothing installs before **Install**; agents ask with a card (pack, size, licence), never install; every install, update and removal is an audited user action.                                               |
| T5  | A security update applies without consent.                                                       | Opt-in only; staged and applied when idle, like the OS; otherwise updates are offered, never taken.                                                                                                          |
| T6  | Removal leaves tools, shims, or config behind (or removes what another experience needs).        | Packs are content-addressed layers; Remove drops the layer; packs and simulators reference-counted across experiences, so removal drops only what the removed experience alone added.                        |
| T7  | A click-through licence (Android SDK) is accepted by a flag or script.                           | Accepted only by the person's click on the device; no flag, seed file, or script accepts for them.                                                                                                           |
| T8  | A non-agent-safe tool poisons agent context (`toolchains` tool).                                 | The capability file is zod-validated; the tool is read-only; one stable context line that changes only when packs change (prompt cache stays warm; no packs means byte-identical requests).                  |
| T9  | Gate commands from the file run unapproved.                                                      | M68's verify loop proposes them; the person approves them as checks; a peer still cannot send a command string (D80.4).                                                                                      |
| T10 | TV runs install commands the person did not see.                                                 | Each command runs only on the person's click, in a visible terminal, followed by a version check; per-OS commands (winget, Homebrew, apt) with the same pins and the same compatibility check.               |
| T11 | The judge micro-benchmark downloads a model without consent, or keeps an unwanted one.           | Offered with its size; declined or offline, the recommendation rests on hardware alone and says "speed not measured"; a fetched model is kept only if chosen.                                                |
| T12 | The judge recommendation invents hardware support (e.g. GPU backend in a container without CDI). | Probes read real hardware; inside a container only what CDI passes in counts; unknown GPU means CPU only with its reason; `src/shared/judgeModels.json` rows carry source and check date.                    |
| T13 | An iOS/Unity expectation the node cannot meet.                                                   | Said plainly: iOS needs macOS/Xcode (cross-platform parts only on Linux); Unity's editor is not a pack.                                                                                                      |

## Residual risks

- Upstream compromise before our pin (a malicious release binary) is bounded
  by pins, digests, SBOM and scan, not eliminated; the index update flow is
  the revocation path.
- The pack CI builds (TP1) run on hosted runners; runner compromise is
  answered by cosign verification failing closed on the node.
