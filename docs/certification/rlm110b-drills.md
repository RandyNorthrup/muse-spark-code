# Drill record — RLM110B: phases r, t, a, b (M110)

Rig `linuxlt`, worktree `/home/randy/lanes/RLM110B`, branch `rec/rlm110b`,
2026-10-22. Commits `b009677412` (Y1), `8941bb603a` (Y2/Y3),
`1debc0c5ca` (Y4), `3ec725fb05` (TP2), `9e3e0168af` (TQ/personas),
`06c2484647` (toolchains/worker/peek/engine/egress), `1bea0cf4a2` (W2),
`3e83b7da37` (makers fix). Threat models per phase stand in
`rlm110b-threat-r.md`, `-t.md`, `-a.md`, `-b.md`, each reviewed before
its phase's code. Counts below were re-run on this rig on 2026-10-22
with the repo-default timeout: 223 unit tests in 25 files, 6 live
drills in 2 files (`MUSE_NODE_DRILL=1`), all green — r 66, t 63, a
13, b 72, plus 9 in the lane-extended `execProtocol` (headless
wiring; the file predates the lane).

## Phase r — network resilience (Y1–Y4)

- Green, unit (66): `turnResilience` + `turnResume` + `faultRig` (32),
  `nodeAddressBook` + `nodeLiveness` + `nodeLease` (24),
  `nodeStepKeys` + `nodeResultQueue` + `nodeNetWatch` (10). Turns
  pause/resume across a dropped connection, identity addressing with
  liveness states, leased checkpointed idempotent jobs.
- Red, fault rig (`scripts/fault-rig.mjs`, 5 scenarios):
  `s1-stream-cut`, `s2-compaction-cut`, `s3-renumber`, `s4-partition`,
  `s5-redelivery`. `faultRig.test.ts` lists them, refuses an unknown
  scenario and bare usage, probes the namespace requirement aloud, and
  passes a real scenario end to end.

## Phase t — questionnaire and packs (TQ, TP1, TP2, TA, TV)

- Green, unit (63): `nodePacks` + `nodeProfile` +
  `nodePackDefinitions` (49), `nodeToolchains` (7), `nodeGuidedInstall`
  (7). Ten personas, fourteen packs, shell+crosscutting always,
  click-through only Android SDK.
- Green, TP1 sweep: all 14 packs locked and built for x64, 144
  container smokes green in `debian:trixie-slim` read-only mounts
  (`node scripts/build-packs.mjs build --arch x64 --smoke-container`,
  outputs under `$TMPDIR/pack-build`, 33G). Layer tarballs are
  deterministic (`--sort=name`, fixed mtime, owner 0, `gzip -n`).
- Green, index plumbing: `index --out $TMPDIR/pack-build --tag
rlm110b-drill --revision 7 --built-by rlm110b` writes 14 packs,
  revision 7, builtBy `rlm110b`, all 14 artifact URLs stamped
  `.../releases/download/rlm110b-drill/<pack>-x64.tar.gz`.
- Green, refresh: `refresh --out $TMPDIR/pack-build` exits 0 — 13
  packs fresh, `rust-nightly` STALE by one nightly (daily churn; the
  weekly pack CI relocks), `typescript` HELD at 6.0.3 by its
  constraint (7 outside `>=6.0.0 <6.1.0`, with the reason said).
- Red: the semgrep 1.182.0→1.182.1 mid-lane skew was caught by lock
  drift (relocked, rebuilt); TP2 verify-before-use refuses bad
  checksums, downgrades and expired indexes (unit).
- Blocked: TJ waits on M125 lane H (not on main); arm64 locks exist
  but arm64 layers were not built here (ARM runners/QEMU matrix);
  pack CI (`node-packs.yml`: cosign/SBOM/Trivy/release) is written
  but unproven on hosted runners.

## Phase a — worker (R1, F1, P)

- Green, unit (13): `nodeForwarding` + `nodeRoles` + `nodePairing`.
  Opaque M100-E intake, per-action digest binding with monotonic
  expiry and one answer, versioned invitations with full
  fingerprints and both-sides confirm.
- Red: unknown-pair, stale-epoch and bad-frame intakes refused;
  Bypass never accepted as an approval; unpair durable.
- Open: the runtime dispatcher and durable pair store wait on M100
  lanes E/S/G/P + X2 (the ephemeral directory serves tests/local).

## Phase b — sandboxes, workspaces, peek (W1, W2, K)

- Green, unit (72): `nodeEngine` (9, incl. image digest read-back),
  `nodeEgressPolicy` (7) + `nodeEgressSni` (5), `nodeWorkspaceGit` +
  `nodeWorkspaceSnapshots` (11), `nodeWorkspaceDevcontainer` (28),
  `nodePeekTap` (8) + `nodePeekCommand` (4).
- Green, live drills (6): sandbox engine runs a box, freezes it and
  reads the marker back from the snapshot; the egress proxy allows
  and refuses live; workspace git clones, snapshots and restores
  with ignored files kept; repository filters run off; pushes,
  merges, submodules, config and runners refused without running
  git; the devcontainer path checks the pinned CLI version, reads,
  gates and merges, brings the box up from the override, execs a
  marker, and reads the image digest back (`sha256:`, repo digests
  matched). No drill leaves a box behind.
- Red: every gate above fires on purpose in unit (untrusted,
  compose, host-command, run-args, host-mount, host-context,
  no/both-source, volume path-sources); wrong-binary runs type as
  version-skew, cli-failed and bad-output; failing exec exits
  carried, never thrown; the CLI's non-zero error result parses to
  its message, never a box; SNI must match the CONNECT host,
  metadata always blocked, any non-public DNS answer refuses the
  whole.
- Open: digest recording waits on the workspace store; the
  broker-joint SSH live leg waits on M109; `/peek` route/CLI/links
  wait on A0/transport.

## QEMU and containers (brief proof)

No KVM, binfmt or userns on the rig; ARM via container + TCG. Alpine
6.12.38 (`boot/` under `$TMPDIR/qemu-drill`, kept with `SHA256`).

- x64, rig QEMU, TCG (exit 0, re-run 2026-10-22,
  `$TMPDIR/qemu-drill/x64/x64-rerun.log`):
  `qemu-system-x86_64 -machine q35,accel=tcg -m 512 -kernel
boot/vmlinuz-virt -initrd boot/initramfs-virt -nographic -append
"console=ttyS0"`, then `uname -rm` → `6.12.38-0-virt x86_64`,
  then `poweroff -f` → `reboot: Power down`.
- aarch64, makers-layer QEMU in a container (exit 0, re-run
  2026-10-22, `$TMPDIR/qemu-drill/arm-rerun.log`):
  `docker run --rm -i -e
LD_LIBRARY_PATH=/packs/makers/usr/lib/x86_64-linux-gnu -v
<layers>/makers-x64:/packs/makers:ro -v <boot>:/boot:ro
debian:trixie-slim
/packs/makers/usr/bin/qemu-system-aarch64 -machine virt,accel=tcg
-cpu cortex-a72 -m 512 -kernel /boot/vmlinuz-virt -initrd
/boot/initramfs-virt -nographic -append "console=ttyAMA0" -L
/packs/makers/usr/share/qemu -nic none`, then `uname -rm` →
  `6.12.38-0-virt aarch64`, then `poweroff -f`. This drill found
  the missing `ipxe-qemu` (`efi-virtio.rom` now in the layer and
  lock, commit `3e83b7da37`).
- Containers: the 144 TP1 smokes above, plus the devcontainer drill
  (real daemon) and the sandbox drills (real daemon).

## Not claimed

Nothing in this lane is in the README, CHANGELOG, Help or release
notes: the standing rule claims a feature only after it was used for
real through the packed product, and these are runtime cores awaiting
integration (A0 merge, M100/M109 joints, transports, UI mounts).
