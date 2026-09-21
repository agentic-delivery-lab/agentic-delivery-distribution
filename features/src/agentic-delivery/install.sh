#!/usr/bin/env bash
set -euo pipefail

control_plane_commit="${CONTROLPLANECOMMIT:-ba7a161b93f3f35849362139ee3a281318e9183c}"
if [[ ! "$control_plane_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "control-plane commit must be a 40-character immutable SHA" >&2
  exit 1
fi

echo "Agentic Delivery Feature is prepared for controller $control_plane_commit"
