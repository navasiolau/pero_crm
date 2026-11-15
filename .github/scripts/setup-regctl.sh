#!/usr/bin/env bash
set -euo pipefail

# Сохраняем уже принятые version/SHA; credentials остаются в штатном Docker config.
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_OS:-}" = Linux
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = navasiolau/pero_crm
test -n "${RUNNER_TEMP:-}"
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 90 \
  https://github.com/regclient/regclient/releases/download/v0.11.6/regctl-linux-amd64 \
  --output "$RUNNER_TEMP/regctl"
printf '8e0e62a497fcdb8048d18aa927a139613176ba0531f412bc541044e28f9856bd  %s\n' "$RUNNER_TEMP/regctl" | sha256sum --check
chmod +x "$RUNNER_TEMP/regctl"
