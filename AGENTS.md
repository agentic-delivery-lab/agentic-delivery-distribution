# Agentic Delivery Distribution

## Mission

This repository distributes an executable developer environment and thin
consumer integrations: Dev Container configuration, Dev Container Features,
bootstrap tooling, Agent Plugin projections, and source locks.

## Boundaries

- Agentic Primitives remains the canonical owner of agents, skills, hooks, and
  capability definitions.
- The Delivery Control Plane remains the canonical owner of lifecycle,
  routing, orchestration, and GitHub mutation.
- Distribution must not copy either control-plane implementation or primitive
  source as an independently editable authority.
- Generated projections require source commit, digest, compatibility target,
  and promotion evidence.

## Supply-chain rules

All external tools and sources are explicitly inventoried and pinned before a
release. Bootstrap never executes an arbitrary downloaded script. Consumer
changes are PR-based, idempotent, opt-in, and reversible.

Run `pnpm distribution:check` and `pnpm test` before a release.

Bootstrap usage is intentionally separate from validation: run
`pnpm bootstrap:plan` first, review the proposed managed files, then run
`pnpm bootstrap:apply` from the consumer repository. The default apply mode
creates missing files and refuses changed local files; `--force` is an
explicit, human-reviewed replacement operation. The consumer provenance lock
at `.agentic-delivery/distribution.lock.json` records the immutable bundle and
source hashes and is not lifecycle or execution state.

Organization-agent promotion is a separate PR-producing boundary. Use
`pnpm agents:promote:plan` and review the generated projection and lock before
`pnpm agents:promote`; never author an organization agent directly in the
private publication repository.
