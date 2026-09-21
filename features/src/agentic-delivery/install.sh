#!/usr/bin/env bash
set -euo pipefail

control_plane_commit="${CONTROLPLANECOMMIT:-d8c77d5e68909c441066532a7bae2af994207316}"
if [[ ! "$control_plane_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "control-plane commit must be a 40-character immutable SHA" >&2
  exit 1
fi

echo "Agentic Delivery Feature is prepared for controller $control_plane_commit"
