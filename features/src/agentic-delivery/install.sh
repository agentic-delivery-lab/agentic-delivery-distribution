#!/usr/bin/env bash
set -euo pipefail

control_plane_commit="${CONTROLPLANECOMMIT:-ce6a0144edeefbb8125962c06f70b9c9c91cde78}"
if [[ ! "$control_plane_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "control-plane commit must be a 40-character immutable SHA" >&2
  exit 1
fi

echo "Agentic Delivery Feature is prepared for controller $control_plane_commit"
