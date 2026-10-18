#!/bin/sh
# M94 K: documented Cursor answers, exercised locally without a model.
while IFS= read -r line || [ -n "$line" ]; do :; done
case "$1" in
  allow) printf '%s\n' '{"permission":"allow"}' ;;
  deny) printf '%s\n' '{"permission":"deny"}'; exit 2 ;;
  crash) printf '%s\n' 'hook crashed' >&2; exit 1 ;;
  garbage) printf '%s\n' 'not json' ;;
  *) exit 1 ;;
esac
