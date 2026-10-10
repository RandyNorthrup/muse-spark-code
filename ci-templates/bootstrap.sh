# Muse Spark Code (Unofficial): shared POSIX bootstrap, generated into the
# four templates by node scripts/sync-ci-bootstrap.mjs. The parent never
# reads the credential. Only names/paths/timestamps cross this subshell.
set +x
set -efu
umask 077
muse_setup="$(
  unset @MUSE_KEY_NAMES@
  # Extra bindings must be declared by NAME, never by value. The launcher
  # reads this same name list and also scrubs every copy of the value.
  for muse_alias in ${MUSE_CI_KEY_ALIASES:-}; do
    case "$muse_alias" in ''|[0-9]*|*[!A-Za-z0-9_]*) echo 'muse-spark: invalid key alias name' >&2; exit 1;; esac
    unset "$muse_alias"
  done
  if [ -z "${MUSE_AGENT_VERSION:-}" ] || [ -z "${MUSE_INPUT_AGENT_PACKAGE_SHA256:-}" ]; then echo 'muse-spark: pin MUSE_AGENT_VERSION and MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
  muse_start_ms=$(($(date +%s) * 1000))
  muse_dir="$(mktemp -d)"
  # timeout(1) bounds the removal where it runs; a missing or broken
  # timeout must not change the exit status, so plain rm is the fallback.
  trap 'timeout -s KILL 5 rm -rf "$muse_dir" 2>/dev/null || rm -rf "$muse_dir"' EXIT HUP INT TERM
  curl --fail --silent --show-error --location --max-time 120 --output "$muse_dir/agent.tgz" "${MUSE_AGENT_URL:-https://registry.npmjs.org/muse-spark-code-acp/-/muse-spark-code-acp-$MUSE_AGENT_VERSION.tgz}"
  muse_sum="$(sha256sum "$muse_dir/agent.tgz")"
  if [ "${muse_sum%% *}" != "$MUSE_INPUT_AGENT_PACKAGE_SHA256" ]; then echo 'muse-spark: the agent package does not match MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
  mkdir "$muse_dir/launcher"
  tar -xzf "$muse_dir/agent.tgz" -C "$muse_dir/launcher" --no-same-owner
  printf '%s:%s' "$muse_start_ms" "$muse_dir"
  trap - EXIT HUP INT TERM
)"
muse_start_ms="${muse_setup%%:*}"
muse_dir="${muse_setup#*:}"
# An exec failure still belongs to this shell, using the same sanitized
# subshell; successful exec belongs to ci-entry from its first statement.
# The trap copies the temp path first: the unset below clears muse_dir, so
# expanding it afterwards trips set -u and skips the removal (RVCM80CI4 P2).
muse_cleanup_dir="$muse_dir"
trap '(muse_rm_dir="$muse_cleanup_dir"; unset @MUSE_KEY_NAMES@; for muse_alias in ${MUSE_CI_KEY_ALIASES:-}; do unset "$muse_alias"; done; timeout -s KILL 5 rm -rf "$muse_rm_dir" 2>/dev/null || rm -rf "$muse_rm_dir")' EXIT HUP INT TERM
MUSE_CI_TEMP="$muse_dir" MUSE_CI_BOOTSTRAP_START_MS="$muse_start_ms" MUSE_INPUT_AGENT_PACKAGE="$muse_dir/agent.tgz" exec node "$muse_dir/launcher/package/ci/lib/ci-entry.mjs" @MUSE_SYSTEM@
