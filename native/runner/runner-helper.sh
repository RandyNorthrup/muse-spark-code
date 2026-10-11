#!/usr/bin/env bash
# This protocol belongs to the extension. A lost SSH connection never releases a slot.
set -eu
root=$2
mkdir -p "$root/runs" "$root/slots" "$root/cache"
action=$1
decode() { base64 -d; }
release_cache_lock() {
  local lock="$root/cache/$cache.creating"
  # Only the matching creator can release; expiry never proves child retirement.
  if [[ -f "$lock/owner" ]] && [[ "$(cat "$lock/owner")" == "$id "* ]]; then
    rm "$lock/owner"
    rmdir "$lock"
  fi
}
strip_credentials() {
  local name restore_case=0
  if ! shopt -q nocasematch; then
    shopt -s nocasematch
    restore_case=1
  fi
  while IFS= read -r name; do
    case "$name" in
      *_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|OPENAI_KEY|ANTHROPIC_KEY|META_KEY|SSH_AUTH_SOCK|SSH_ASKPASS*|GITHUB_TOKEN|GH_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|GNOME_KEYRING_CONTROL|GNOME_KEYRING_PID|GIT_*) unset "$name" ;;
    esac
  done < <(compgen -e)
  if [[ "$restore_case" == 1 ]]; then shopt -u nocasematch; fi
}
case "$action" in
  init) git -c core.hooksPath=/dev/null init --bare "$root/repository.git" >/dev/null; printf '{}\n';;
  health)
    max=$3; free=0
    for ((i=0;i<max;i++)); do
      if [[ ! -f "$root/slots/$i" ]] || [[ -f "$root/runs/$(cat "$root/slots/$i")/exit.json" ]]; then free=$((free+1)); fi
    done
    cores=$(getconf _NPROCESSORS_ONLN)
    load=$(LC_ALL=C uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/')
    printf '{"cores":%s,"load":%s,"freeSlots":%s,"inputReady":true}\n' "$cores" "$load" "$free";;
  status)
    id=$3
    if [[ -f "$root/runs/$id/exit.json" ]]; then cat "$root/runs/$id/exit.json"
    elif [[ -d "$root/runs/$id" ]]; then printf '{"runId":"%s","state":"running"}\n' "$id"
    else printf '{"runId":"%s","state":"missing"}\n' "$id"; fi;;
  output)
    printf '{"bytes":"'
    if [[ -f "$root/runs/$3/output" ]]; then base64 < "$root/runs/$3/output" | tr -d '\r\n'; fi
    printf '"}\n';;
  start)
    id=$3; max=$4; snapshot=$5; cache=$6; setup=$7; command=$8; timeout=$9
    # Exclusive allocation lock is never stolen on a timer or on a PID check.
    if ! mkdir "$root/allocate" 2>/dev/null; then printf '{"runId":"%s","state":"busy"}\n' "$id"; exit 0; fi
    trap 'rmdir "$root/allocate"' EXIT
    slot=
    for ((i=0;i<max;i++)); do
      file="$root/slots/$i"
      if [[ -f "$file" ]] && [[ -f "$root/runs/$(cat "$file")/exit.json" ]]; then rm "$file"; fi
      if (set -C; printf '%s' "$id" > "$file") 2>/dev/null; then slot=$i; break; fi
    done
    if [[ -z "$slot" ]]; then printf '{"runId":"%s","state":"busy"}\n' "$id"; exit 0; fi
    if ! mkdir "$root/runs/$id"; then exit 1; fi
    # nohup detaches the supervisor, not the job. The supervisor owns the process group.
    nohup bash "$0" job "$root" "$id" "$snapshot" "$cache" "$setup" "$command" "$timeout" > "$root/runs/$id/output" 2>&1 < /dev/null &
    printf '{"runId":"%s","state":"running"}\n' "$id";;
  job)
    id=$3; snapshot=$4; cache=$5; setup=$6; command=$7; timeout=$8
    trap '' HUP
    strip_credentials
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    # The timeout cannot kill the creator before publishing its owner record:
    # the surviving supervisor owns creation and cleanup, never the setup child.
    if [[ ! -f "$root/cache/$cache/ready" ]]; then
      if ! mkdir "$root/cache/$cache.creating" 2>/dev/null; then
        touch "$root/runs/$id/cache-busy"
        printf '{"runId":"%s","state":"ended","exitCode":75,"reason":"cacheBusy"}\n' "$id" > "$root/runs/$id/exit.new"
        mv "$root/runs/$id/exit.new" "$root/runs/$id/exit.json"
        exit 0
      fi
      printf '%s %s' "$id" "$(( $(date +%s) + timeout ))" > "$root/cache/$cache.creating/owner"
    fi
    # Job control makes the background job its own process group, including on macOS.
    set -m
    nice -n 10 bash "$0" execute "$root" "$id" "$snapshot" "$cache" "$setup" "$command" &
    group=$!
    (sleep "$timeout"; touch "$root/runs/$id/timed-out"; kill -KILL -- "-$group" 2>/dev/null || true) &
    timer=$!
    set +m
    code=0; wait "$group" || code=$?
    kill "$timer" 2>/dev/null || true
    kill -KILL -- "-$timer" 2>/dev/null || true
    wait "$timer" 2>/dev/null || true
    # Also end children left behind by an otherwise successful command.
    kill -KILL -- "-$group" 2>/dev/null || true
    while kill -0 -- "-$group" 2>/dev/null; do sleep 0.1; done
    if [[ -f "$root/runs/$id/timed-out" ]]; then code=124; fi
    # The supervisor survives the deadline kill and releases only after group retirement.
    release_cache_lock
    reason=
    if [[ -f "$root/runs/$id/cache-busy" ]]; then reason=',"reason":"cacheBusy"'; fi
    printf '{"runId":"%s","state":"ended","exitCode":%s%s}\n' "$id" "$code" "$reason" > "$root/runs/$id/exit.new"
    mv "$root/runs/$id/exit.new" "$root/runs/$id/exit.json";;
  execute)
    id=$3; snapshot=$4; cache=$5; setup=$6; command=$7
    copy="$root/runs/$id/copy"
    git -c core.hooksPath=/dev/null clone --shared --no-checkout "$root/repository.git" "$copy"
    git -C "$copy" -c core.hooksPath=/dev/null checkout --force --detach "$snapshot"
    git -C "$copy" remote remove origin
    git -C "$copy" clean -ffdx
    cd "$copy"
    # A cache creator has exclusive create ownership. Others fall back, never steal it.
    if [[ ! -f "$root/cache/$cache/ready" ]]; then
      if [[ ! -f "$root/cache/$cache.creating/owner" ]] || [[ "$(cat "$root/cache/$cache.creating/owner")" != "$id "* ]]; then exit 1; fi
      # Only this cache's exclusive owner removes an incomplete prior install.
      rm -rf "$root/cache/$cache"
      printf '%s' "$setup" | decode > "$root/runs/$id/setup.sh"
      bash "$root/runs/$id/setup.sh" < /dev/null
      mkdir -p "$root/cache/$cache"
      # Snapshot source is tracked. Cache only the setup's untracked install artifacts.
      mkdir -p "$root/cache/$cache/install"
      while IFS= read -r -d '' entry; do
        destination="$root/cache/$cache/install/$entry"
        mkdir -p "$(dirname "$destination")"
        cp -RP "./$entry" "$destination"
      done < <(git -c core.quotePath=false ls-files --others --directory -z)
      touch "$root/cache/$cache/ready"
    else
      cp -RP "$root/cache/$cache/install/." .
    fi
    printf '%s' "$command" | decode > "$root/runs/$id/command.sh"
    bash "$root/runs/$id/command.sh" < /dev/null;;
  *) exit 1;;
esac
