# Muse Spark Code (Unofficial): the one POSIX bootstrap for the other-CI
# templates (PLAN.md M80/D65). This file is the source of truth:
# scripts/sync-ci-bootstrap.mjs copies it into gitlab-ci.yml,
# azure-pipelines.yml, Jenkinsfile and bitbucket-pipelines.yml (stamping in
# the template's system name), and the template tests refuse any drift.
# POSIX sh only.
#
# Key handling: the two holders below are unset before they are assigned,
# so an exported holder arriving from the environment cannot keep its
# export attribute; every secret name is unset before any child runs;
# the key lands in a private file, never an exported variable, and the
# launcher reads it from its stdin alone.
set +x
set -eu
umask 077
unset muse_key muse_key_file
muse_key="${MUSE_MODEL_API_KEY:-}"
muse_key_file="${MUSE_MODEL_API_KEY_FILE:-}"
unset MUSE_MODEL_API_KEY MUSE_MODEL_API_KEY_FILE MUSE_SPARK_MODEL_API_KEY META_API_KEY
muse_start_ms=$(($(date +%s) * 1000))
if [ -z "${MUSE_AGENT_VERSION:-}" ] || [ -z "${MUSE_INPUT_AGENT_PACKAGE_SHA256:-}" ]; then echo 'muse-spark: pin MUSE_AGENT_VERSION and MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
muse_dir="$(mktemp -d)"
trap 'rm -rf "$muse_dir"' EXIT HUP INT TERM
if [ -n "$muse_key_file" ] && [ -f "$muse_key_file" ]; then
  cp "$muse_key_file" "$muse_dir/key" || { echo 'muse-spark: cannot read the key file' >&2; exit 1; }
else
  printf '%s' "$muse_key" > "$muse_dir/key"
fi
unset muse_key muse_key_file
chmod 600 "$muse_dir/key"
curl --fail --silent --show-error --location --max-time 120 --output "$muse_dir/agent.tgz" "${MUSE_AGENT_URL:-https://registry.npmjs.org/muse-spark-code-acp/-/muse-spark-code-acp-$MUSE_AGENT_VERSION.tgz}"
muse_sum="$(sha256sum "$muse_dir/agent.tgz")"
if [ "${muse_sum%% *}" != "$MUSE_INPUT_AGENT_PACKAGE_SHA256" ]; then echo 'muse-spark: the agent package does not match MUSE_INPUT_AGENT_PACKAGE_SHA256' >&2; exit 1; fi
mkdir "$muse_dir/launcher"
tar -xzf "$muse_dir/agent.tgz" -C "$muse_dir/launcher" --no-same-owner
MUSE_CI_TEMP="$muse_dir" MUSE_CI_BOOTSTRAP_START_MS="$muse_start_ms" MUSE_INPUT_AGENT_PACKAGE="$muse_dir/agent.tgz" exec node "$muse_dir/launcher/package/ci/lib/ci-run.mjs" @MUSE_SYSTEM@ < "$muse_dir/key"
