#!/usr/bin/env bash
set -euo pipefail

control_plane_commit="${CONTROLPLANECOMMIT:-0956144e5b9229209ad0fb82299a1d99a366ac66}"
if [[ ! "$control_plane_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "control-plane commit must be a 40-character immutable SHA" >&2
  exit 1
fi

echo "Agentic Delivery Feature is prepared for controller $control_plane_commit"
