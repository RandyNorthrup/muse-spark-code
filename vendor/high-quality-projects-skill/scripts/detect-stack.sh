#!/usr/bin/env bash
# detect-stack.sh — inventory a workspace before changing anything.
#
# Emits JSON on stdout describing which languages are present, which quality
# tools are already configured, and which of the required tools are installed
# on this machine. Every workflow runs this FIRST so it extends what exists
# instead of overwriting it.
#
#   ./detect-stack.sh [path]     default: cwd
#
# Exit codes: 0 always (a scan finding nothing is not an error).

set -uo pipefail
ROOT="${1:-.}"
cd "${ROOT}" 2> /dev/null || {
    echo '{"error":"unreadable path"}'
    exit 0
}

# ── helpers ─────────────────────────────────────────────────────────────
# Directory names skipped during the source count, matched case-insensitively
# like the PowerShell scanner.
PRUNE=(-iname node_modules -o -iname .git -o -iname dist -o -iname build
    -o -iname target -o -iname vendor -o -iname .venv -o -iname venv
    -o -iname __pycache__ -o -iname bin -o -iname obj)

# Encode text as a JSON string. A POSIX path may legally contain quotes,
# backslashes, and control characters, all of which JSON must escape.
json_string() {
    local value="$1" escaped="" char code index
    for ((index = 0; index < ${#value}; index++)); do
        char="${value:index:1}"
        case "${char}" in
            \\) escaped+="\\\\" ;;
            '"') escaped+='\"' ;;
            [[:cntrl:]])
                printf -v code '\\u%04x' "'${char}"
                escaped+="${code}"
                ;;
            *) escaped+="${char}" ;;
        esac
    done
    printf '"%s"' "${escaped}"
}

# Print one JSON member. $3 is the separator: "," or "" for the last member.
bool_member() {
    if [[ "$2" == true ]]; then
        printf '    "%s": true%s\n' "$1" "$3"
    else
        printf '    "%s": false%s\n' "$1" "$3"
    fi
}

# $1 = key, $2 = separator, remaining = candidate paths; true if any exists.
file_member() {
    local key="$1" separator="$2" path found=false
    shift 2
    for path in "$@"; do
        [[ -e "${path}" ]] && found=true
    done
    bool_member "${key}" "${found}" "${separator}"
}

# $1 = key, $2 = separator, $3 = command name on PATH.
tool_member() {
    local found=false
    command -v "$3" > /dev/null 2>&1 && found=true
    bool_member "$1" "${found}" "$2"
}

# $1 = key, $2 = separator, remaining = paths; prints the existing ones in order.
present_array_member() {
    local key="$1" separator="$2" path items=""
    shift 2
    for path in "$@"; do
        [[ -e "${path}" ]] && items="${items:+${items}, }\"${path}\""
    done
    printf '  "%s": [%s]%s\n' "${key}" "${items}" "${separator}"
}

if [[ -e .git ]]; then
    is_repo=true
    has_remote=false
    remotes="$(git remote 2> /dev/null)" && [[ -n "${remotes}" ]] && has_remote=true
    tracked_files="$(git ls-files 2> /dev/null | wc -l | tr -d ' ')"
else
    is_repo=false
    has_remote=false
    tracked_files=0
fi

# ── Python tools: PATH is not the whole story ───────────────────────────
# A Python tool installed into an unactivated venv, or on Windows where the
# console scripts directory is frequently absent from PATH, is fully usable via
# `python -m <module>` while `command -v` reports it missing. Probing PATH alone
# therefore reports an installed gate as unavailable, and the skills then defer
# a gate that could have run — or reinstall a tool that is already present.
#
# find_spec resolves the import machinery only; it does not execute the package,
# and one interpreter start covers every module, so the scan stays fast.
# Do not take the first interpreter on PATH. `python3` on Windows is usually the
# Store alias stub, which is on PATH, is not an interpreter, and reports every
# module missing. A machine can also carry several real interpreters where only
# one has the tools. So probe every candidate and keep whichever resolves the
# most modules — a stub resolves none and loses automatically.
#
# Module names, not command names — these are what follows `-m`, and the two
# differ for hyphenated tools (`pip-audit` is imported as `pip_audit`).
py_probe() {
    "$1" - << 'PYEOF' 2> /dev/null
import importlib.util

MODULES = ("ruff", "mypy", "vulture", "bandit", "pip_audit",
           "deptry", "pytest", "semgrep", "pre_commit")

found = []
for module in MODULES:
    try:
        if importlib.util.find_spec(module) is not None:
            found.append(module)
    except (ImportError, ValueError):
        pass  # a broken or shadowed install is not an available tool
print(" ".join(found))
PYEOF
}

PY_BIN=""
PY_MODULES=""
py_best=-1
for candidate in python3 python py; do
    command -v "${candidate}" > /dev/null 2>&1 || continue
    found="$(py_probe "${candidate}")" || continue # stub or broken interpreter
    found="${found//$'\r'/}"                       # Windows interpreter line endings
    count="$(printf '%s' "${found}" | wc -w | tr -d ' ')"
    if ((count > py_best)); then
        py_best="${count}"
        PY_BIN="${candidate}"
        PY_MODULES="${found}"
    fi
done

# $1 = key, $2 = separator, $3 = command name on PATH, $4 = importable module.
py_tool_member() {
    local found=false
    if command -v "$3" > /dev/null 2>&1; then
        found=true
    else
        case " ${PY_MODULES} " in
            *" $4 "*) found=true ;;
            *) ;;
        esac
    fi
    bool_member "$1" "${found}" "$2"
}

# Tools reachable only as modules must be invoked as `$PY_BIN -m <module>`.
# Reported separately so a skill knows which form to use rather than guessing.
MODULE_ONLY=""
for module in ${PY_MODULES}; do
    command -v "${module//_/-}" > /dev/null 2>&1 ||
        MODULE_ONLY="${MODULE_ONLY:+${MODULE_ONLY}, }\"${module}\""
done

# ── PowerShell modules ──────────────────────────────────────────────────
# Gate modules live in PowerShell's module path, not on PATH. Pester 3.x ships
# inside Windows PowerShell but cannot run Pester 5 tests, so only 5+ counts.
PS_MODULES=""
if command -v pwsh > /dev/null 2>&1; then
    # shellcheck disable=SC2016 # $found and $_ are PowerShell variables.
    PS_MODULES="$(pwsh -NoLogo -NoProfile -NonInteractive -Command '
        $found = @()
        if (Get-Module -ListAvailable -Name PSScriptAnalyzer) { $found += "psscriptanalyzer" }
        if (Get-Module -ListAvailable -Name Pester |
            Where-Object { $_.Version.Major -ge 5 }) { $found += "pester" }
        $found -join " "
    ' 2> /dev/null)" || PS_MODULES=""
    PS_MODULES="${PS_MODULES//$'\r'/}"
fi

# $1 = key, $2 = separator, $3 = module identifier from the probe above.
ps_module_member() {
    local found=false
    case " ${PS_MODULES} " in
        *" $3 "*) found=true ;;
        *) ;;
    esac
    bool_member "$1" "${found}" "$2"
}

# ── language detection by source-file count ─────────────────────────────
# One traversal for every extension. Extensions compare case-insensitively and
# each is capped at 5000 files, matching the PowerShell scanner.
LANGUAGES="$(find . \( "${PRUNE[@]}" \) -prune -o -type f -print 2> /dev/null |
    awk -v cap=5000 '
        BEGIN {
            split("py ts tsx js jsx mjs rs cs cpp cc cxx hpp h ps1 psm1 css scss html sh go", known, " ")
            for (i in known) count[known[i]] = 0
        }
        {
            name = $0
            sub(/.*\//, "", name)
            dot = match(name, /\.[^.]*$/)
            if (dot == 0) next
            extension = tolower(substr(name, dot + 1))
            if ((extension in count) && count[extension] < cap) count[extension]++
        }
        END {
            printf "    \"python\": %d,\n", count["py"]
            printf "    \"typescript\": %d,\n", count["ts"] + count["tsx"]
            printf "    \"javascript\": %d,\n", count["js"] + count["jsx"] + count["mjs"]
            printf "    \"rust\": %d,\n", count["rs"]
            printf "    \"csharp\": %d,\n", count["cs"]
            printf "    \"cpp\": %d,\n", count["cpp"] + count["cc"] + count["cxx"] + count["hpp"] + count["h"]
            printf "    \"powershell\": %d,\n", count["ps1"] + count["psm1"]
            printf "    \"css\": %d,\n", count["css"] + count["scss"]
            printf "    \"html\": %d,\n", count["html"]
            printf "    \"shell\": %d,\n", count["sh"]
            printf "    \"go\": %d\n", count["go"]
        }')"

# ── JSON document ───────────────────────────────────────────────────────
printf '{\n'
printf '  "root": '
json_string "${PWD}"
printf ',\n'
printf '  "git": {\n'
printf '    "is_repo": %s,\n' "${is_repo}"
printf '    "has_remote": %s,\n' "${has_remote}"
printf '    "tracked_files": %s\n' "${tracked_files}"
printf '  },\n'
printf '  "languages": {\n%s\n  },\n' "${LANGUAGES}"

# Existing quality configuration: the "do not clobber" list.
printf '  "existing_config": {\n'
file_member pyproject_toml , pyproject.toml
file_member ruff_toml , ruff.toml
file_member setup_cfg , setup.cfg
file_member mypy_ini , mypy.ini
file_member tox_ini , tox.ini
file_member package_json , package.json
file_member tsconfig_json , tsconfig.json
file_member eslint_config_mjs , eslint.config.mjs
file_member eslint_config_js , eslint.config.js
file_member eslintrc_json , .eslintrc.json
file_member eslintrc_cjs , .eslintrc.cjs
file_member prettierrc , .prettierrc
file_member stylelintrc_json , .stylelintrc.json
file_member knip_json , knip.json
file_member knip_jsonc , knip.jsonc
file_member cargo_toml , Cargo.toml
file_member clippy_toml , clippy.toml
file_member deny_toml , deny.toml
file_member rustfmt_toml , rustfmt.toml
file_member go_mod , go.mod
file_member golangci , .golangci.yml .golangci.yaml .golangci.toml .golangci.json
file_member clang_tidy , .clang-tidy
file_member clang_format , .clang-format
file_member cmakelists , CMakeLists.txt
file_member directory_build_props , Directory.Build.props
file_member editorconfig , .editorconfig
file_member psscriptanalyzer , PSScriptAnalyzerSettings.psd1
file_member pre_commit , .pre-commit-config.yaml
file_member gitignore , .gitignore
file_member gitattributes , .gitattributes
file_member env_example , .env.example
file_member dockerfile , Dockerfile
file_member github_workflows , .github/workflows
file_member dependabot , .github/dependabot.yml .github/dependabot.yaml
file_member renovate , renovate.json renovate.json5 .github/renovate.json \
    .github/renovate.json5 .renovaterc .renovaterc.json
file_member readme , README.md
file_member changelog , CHANGELOG.md
file_member plan , PLAN.md
file_member license , LICENSE
file_member agents_md , AGENTS.md
file_member claude_md '' CLAUDE.md
printf '  },\n'

# Dependency locks and runtime/toolchain pins, in a fixed order.
present_array_member lockfiles , package-lock.json npm-shrinkwrap.json \
    pnpm-lock.yaml yarn.lock bun.lock bun.lockb uv.lock poetry.lock \
    Pipfile.lock pdm.lock Cargo.lock go.sum packages.lock.json
present_array_member toolchain_pins , .python-version .nvmrc .node-version \
    .tool-versions rust-toolchain.toml rust-toolchain global.json

printf '  "tools_installed": {\n'
py_tool_member ruff , ruff ruff
py_tool_member mypy , mypy mypy
py_tool_member vulture , vulture vulture
py_tool_member bandit , bandit bandit
py_tool_member pip_audit , pip-audit pip_audit
py_tool_member deptry , deptry deptry
py_tool_member pytest , pytest pytest
py_tool_member semgrep , semgrep semgrep
tool_member node , node
tool_member npm , npm
tool_member tsc , tsc
tool_member eslint , eslint
tool_member prettier , prettier
tool_member stylelint , stylelint
tool_member knip , knip
tool_member dpdm , dpdm
tool_member htmlhint , htmlhint
tool_member jscpd , jscpd
tool_member madge , madge
tool_member cargo , cargo
tool_member cargo_audit , cargo-audit
tool_member cargo_machete , cargo-machete
tool_member cargo_deny , cargo-deny
tool_member go , go
tool_member gofmt , gofmt
tool_member staticcheck , staticcheck
tool_member govulncheck , govulncheck
tool_member golangci_lint , golangci-lint
tool_member dotnet , dotnet
tool_member roslynator , roslynator
tool_member gcc , gcc
tool_member clang , clang
tool_member clang_tidy , clang-tidy
tool_member clang_format , clang-format
tool_member cppcheck , cppcheck
tool_member valgrind , valgrind
tool_member gcovr , gcovr
tool_member pwsh , pwsh
ps_module_member psscriptanalyzer , psscriptanalyzer
ps_module_member pester , pester
tool_member shellcheck , shellcheck
tool_member shfmt , shfmt
tool_member bats , bats
tool_member actionlint , actionlint
tool_member zizmor , zizmor
tool_member osv_scanner , osv-scanner
tool_member hadolint , hadolint
tool_member gitleaks , gitleaks
py_tool_member pre_commit '' pre-commit pre_commit
printf '  },\n'

printf '  "python_runtime": {\n'
printf '    "bin": '
json_string "${PY_BIN}"
printf ',\n'
printf '    "module_only_tools": [%s]\n' "${MODULE_ONLY}"
printf '  }\n'
printf '}\n'
