# Muse Spark Code (Unofficial): shared POSIX bootstrap, generated into the
# four templates by node scripts/sync-ci-bootstrap.mjs. The parent never
# reads the credential. Only names/paths/timestamps cross this subshell.
set +x
set -efu
umask 077
# timeout(1) bounds temp removal where it runs. Probe once, before any trap
# is armed: a missing timeout selects plain rm up front, and a removal that
# itself exceeds the bound is never retried without one. The holder uses the
# reserved internal namespace so declared aliases cannot overwrite it.
if command -v timeout >/dev/null 2>&1; then muse_ci_internal_rm='timeout -s KILL 5 rm -rf'; else muse_ci_internal_rm='rm -rf'; fi
# Parent holders own paths, never credentials. Reserve their namespace before
# assigning the bootstrap result, so declared bindings cannot be overwritten.
for muse_ci_internal_alias in ${MUSE_CI_KEY_ALIASES:-}; do
  case "$muse_ci_internal_alias" in ''|[0-9]*|*[!A-Za-z0-9_]*|muse_ci_internal_*|MUSE_CI_*|MUSE_INPUT_*|MUSE_AGENT_*) echo 'muse-spark: invalid or reserved key alias name' >&2; exit 1;; esac
done
# Extra bindings must be declared by NAME, never by value. The launcher
# reads this same name list and also scrubs every copy of the value. Every
# name was validated by the reserved-prefix loop above (its shape check
# subsumes the old inner one); macOS sh (bash 3.2) cannot parse case inside
# $( ), so only the value removals stay in this subshell, keeping the
# download children blind to every declared copy.
muse_ci_internal_setup="$(
  unset @MUSE_KEY_NAMES@
  for muse_alias in ${MUSE_CI_KEY_ALIASES:-}; do unset "$muse_alias"; done
  if [ -z "${MUSE_AGENT_VERSION:-}" ] || [ -z "${MUSE_INPUT_AGENT_PACKAGE_SHA256:-}" ]; then echo 'muse-spark: pin MUSE_AGENT_VERSION and MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
  # The download runs before Node maps the inputs into its child
  # environment, so the bootstrap maps the network inputs itself: the proxy
  # inputs become the standard variables curl reads, and the CA input is
  # refused here when it is not a readable file. Vendor-standard proxy
  # variables set on the job already reach curl unchanged.
  if [ -n "${MUSE_INPUT_HTTPS_PROXY:-}" ]; then https_proxy="$MUSE_INPUT_HTTPS_PROXY"; HTTPS_PROXY="$MUSE_INPUT_HTTPS_PROXY"; export https_proxy HTTPS_PROXY; fi
  if [ -n "${MUSE_INPUT_NO_PROXY:-}" ]; then no_proxy="$MUSE_INPUT_NO_PROXY"; NO_PROXY="$MUSE_INPUT_NO_PROXY"; export no_proxy NO_PROXY; fi
  if [ -n "${MUSE_INPUT_EXTRA_CA_CERTS:-}" ] && [ ! -r "$MUSE_INPUT_EXTRA_CA_CERTS" ]; then echo 'muse-spark: MUSE_INPUT_EXTRA_CA_CERTS is not readable' >&2; exit 1; fi
  muse_start_ms=$(($(date +%s) * 1000))
  muse_dir="$(mktemp -d)"
  # One bounded removal (muse_ci_internal_rm, probed above): a removal that
  # exceeds its bound is reported, never retried without one.
  trap '$muse_ci_internal_rm "$muse_dir" 2>/dev/null' EXIT HUP INT TERM
  if [ -n "${MUSE_INPUT_EXTRA_CA_CERTS:-}" ]; then
    curl --fail --silent --show-error --location --max-time 120 --cacert "$MUSE_INPUT_EXTRA_CA_CERTS" --output "$muse_dir/agent.tgz" "${MUSE_AGENT_URL:-https://registry.npmjs.org/muse-spark-code-acp/-/muse-spark-code-acp-$MUSE_AGENT_VERSION.tgz}"
  else
    curl --fail --silent --show-error --location --max-time 120 --output "$muse_dir/agent.tgz" "${MUSE_AGENT_URL:-https://registry.npmjs.org/muse-spark-code-acp/-/muse-spark-code-acp-$MUSE_AGENT_VERSION.tgz}"
  fi
  muse_sum="$(sha256sum "$muse_dir/agent.tgz")"
  if [ "${muse_sum%% *}" != "$MUSE_INPUT_AGENT_PACKAGE_SHA256" ]; then echo 'muse-spark: the agent package does not match MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
  mkdir "$muse_dir/launcher"
  tar -xzf "$muse_dir/agent.tgz" -C "$muse_dir/launcher" --no-same-owner
  printf '%s:%s' "$muse_start_ms" "$muse_dir"
  trap - EXIT HUP INT TERM
)"
muse_ci_internal_start_ms="${muse_ci_internal_setup%%:*}"
muse_ci_internal_dir="${muse_ci_internal_setup#*:}"
# A launch failure still belongs to this shell: plain invocation (not exec)
# keeps every shell's exit status, because macOS sh (bash 3.2) reports a
# failed bare exec as success once an EXIT trap runs. The reserved holders
# survive both generated and alias unsets.
trap '(muse_ci_internal_rm_dir="$muse_ci_internal_dir"; unset @MUSE_KEY_NAMES@; for muse_alias in ${MUSE_CI_KEY_ALIASES:-}; do unset "$muse_alias"; done; $muse_ci_internal_rm "$muse_ci_internal_rm_dir" 2>/dev/null)' EXIT HUP INT TERM
MUSE_CI_TEMP="$muse_ci_internal_dir" MUSE_CI_BOOTSTRAP_START_MS="$muse_ci_internal_start_ms" MUSE_INPUT_AGENT_PACKAGE="$muse_ci_internal_dir/agent.tgz" node "$muse_ci_internal_dir/launcher/package/ci/lib/ci-entry.mjs" @MUSE_SYSTEM@
