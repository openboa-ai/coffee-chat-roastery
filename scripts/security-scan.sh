#!/bin/sh
set -eu

scanner=${GITLEAKS_BIN:-gitleaks}
if ! command -v "$scanner" >/dev/null 2>&1; then
  printf '%s\n' 'Gitleaks is required; install Gitleaks before scanning.' >&2
  exit 1
fi

test ! -e .gitleaks.toml
test ! -e .gitleaksignore
config_dir="$(mktemp -d)"
trap 'rm -rf "$config_dir"' EXIT HUP INT TERM
config_path="$config_dir/gitleaks.toml"
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml" \
  --output "$config_path"
expected=e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf
actual="$(shasum -a 256 "$config_path" | awk '{print $1}')"
test "$actual" = "$expected"

"$scanner" git --config "$config_path" --gitleaks-ignore-path /dev/null \
  --ignore-gitleaks-allow --redact --no-banner .
"$scanner" dir --config "$config_path" --gitleaks-ignore-path /dev/null \
  --ignore-gitleaks-allow --redact --no-banner .
