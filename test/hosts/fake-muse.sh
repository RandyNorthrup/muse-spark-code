#!/bin/sh
# The fake Muse Code CLI for the host checks (hosts.yml), installed in DIR:
# DIR/bin/muse runs test/e2e/fake-muse/serve.mjs, and DIR/config holds the
# credential file the extension, the agent and the fake's `account/read`
# read under XDG_CONFIG_HOME: a browser sign-in's shape as captured
# (test/unit/helpers/credentialShapes.ts), placeholders only, no secret.
# Prints DIR/bin/muse.
#
#   sh test/hosts/fake-muse.sh DIR
set -eu
dir="$1"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$dir/bin" "$dir/config/muse"
cp "$here/../e2e/fake-muse/serve.mjs" "$dir/bin/serve.mjs"
printf '#!/usr/bin/env node\nimport("file://%s/bin/serve.mjs")\n' "$(cd "$dir" && pwd)" > "$dir/bin/muse"
chmod 755 "$dir/bin/muse"
printf '{"schema_version":1,"providers":{"meta":{"access_token":"<placeholder>","obtained_via":"device_code","mechanism":"oauth","api_key":"<placeholder>","api_base_url":"<placeholder>"}}}\n' \
  > "$dir/config/muse/auth.json"
echo "$(cd "$dir" && pwd)/bin/muse"
