#!/usr/bin/env bash
set -euo pipefail

control_plane_commit="${CONTROLPLANECOMMIT:-02b2727c582fc181a8622e86e0ed87b2e81c98f3}"
if [[ ! "$control_plane_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "control-plane commit must be a 40-character immutable SHA" >&2
  exit 1
fi

echo "Agentic Delivery Feature is prepared for controller $control_plane_commit"
