#!/bin/sh
# M80 H1-H4 against an installed PRODUCTION package. --store adds H3 only
# inside an isolated, unlocked OS credential store. All credentials fabricated.
# sh test/hosts/exec.sh <installed-package-root> [--store]
set -eu
package=$(cd "$1" && pwd)
mode=${2:-}
agent="$package/dist/acp.js"
export LANG=C LC_ALL=C
mkdir -p temp
work=$(mktemp -d "$(pwd)/temp/m80-host.XXXXXX")
stored=0
cleanup() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$stored" = 1 ]; then
    if ! node "$agent" auth clear; then code=1; fi
  fi
  rm -rf -- "$work"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
fail() { echo "FAIL $1" >&2; exit 1; }

node "$agent" --help > "$work/help"
grep -Fq 'exec' "$work/help" || fail 'exec help'
grep -Fq 'scan-secrets' "$work/help" || fail 'scanner help'
code=0
node "$agent" exec --trust-workspace hello > "$work/refused" 2>&1 || code=$?
[ "$code" = 2 ] || fail 'trust flag must exit 2'
node --input-type=module - "$package" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
for (const kind of ['result', 'event']) {
  const file = path.join(process.argv[2], 'schemas', `exec-${kind}-v1.schema.json`)
  const schema = JSON.parse(readFileSync(file, 'utf8'))
  const variants = kind === 'event' ? schema.anyOf : [schema]
  assert.ok(variants.length > 0)
  for (const variant of variants) {
    assert.equal(variant.properties.v.const, 1)
    assert.ok(variant.required.includes(kind === 'result' ? 'status' : 'type'))
  }
}
JS

# Reuse the existing captured-wire fake, compiled only into this test's private
# preload. The installed acp/modelApi/uiText bundles remain byte-for-byte product.
node --input-type=module - "$work" <<'JS'
import { build } from 'esbuild'
import path from 'node:path'
await build({
  stdin: {
    contents: `
      import Module from 'node:module';
      import { fakeModelApi } from ${JSON.stringify(path.resolve('test/unit/helpers/fakeModelApi.ts'))};
      const load = Module._load;
      Module._load = function(id, parent, isMain) {
        if (id === '@napi-rs/keyring' && process.env.M80D_STORE !== '1') throw new Error('stdin opened keyring');
        return load.call(this, id, parent, isMain);
      };
      const api = fakeModelApi();
      api.models = ['muse-spark-1.3-contributor'];
      api.script({text:'ok', usage:{input:10,output:5}});
      globalThis.fetch = api.fetch;
    `,
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile: path.join(process.argv[2], 'fake.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent',
})
JS
run_exec() {
  node --require "$work/fake.cjs" "$agent" exec --backend modelApi \
    --cwd "$work" --model muse-spark-1.3-contributor --allow-contributor-models \
    --max-budget-usd 1.00 --ephemeral --output json "$@" 'Reply ok.' > "$work/result.json"
  node --input-type=module - "$work/result.json" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'))
assert.equal(result.status, 'completed')
assert.equal(result.exitCode, 0)
assert.equal(result.usage.requests, 1)
assert.equal(result.finalMessage, 'ok')
JS
}
assert_absent() {
  node - "$package" "$work/status" <<'JS'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { EN } = require(path.join(process.argv[2], 'dist', 'uiText.js'))
assert.equal(readFileSync(process.argv[3], 'utf8').trim(), EN.acpKeyAbsent)
JS
}
# The shared fake answers only its own fabricated key (FAKE_MODEL_API_KEY);
# any other key gets its 401, and exec exits 3.
key='LLM|1|secret'

if [ "$mode" = '--store' ]; then
  # Refuse an existing key AND an unavailable store before any mutation.
  if node "$agent" auth status > "$work/status" 2> "$work/status-error"; then
    fail 'a key was stored before the check'
  fi
  assert_absent
  stored=1
  printf '%s\n' "$key" | node "$agent" auth set
  node "$agent" auth status
  M80D_STORE=1 run_exec
  node "$agent" auth clear
  stored=0
  if node "$agent" auth status > "$work/status" 2> "$work/status-error"; then fail 'key outlived clear'; fi
  assert_absent
elif [ -z "$mode" ]; then
  printf '%s\n' "$key" | run_exec --key-stdin
else
  fail 'expected --store or no second argument'
fi
echo 'ok   installed headless help, schemas, trust refusal and fake-only exec'
