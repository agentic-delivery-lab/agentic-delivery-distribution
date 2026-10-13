# Agentic Delivery Distribution

This repository packages the executable developer environment and thin
consumer integration for Agentic Delivery:

- Dev Container and Feature definitions;
- idempotent bootstrap into a consumer repository;
- reusable workflow callers pinned to an immutable Control Plane commit; and
- Agent Plugin projections from approved Primitive and Automation releases.

The package does not contain the generic lifecycle, routing state machine,
organization credentials, or canonical agent/skill implementations.

The workflow bundle records two independent immutable references: the
Control Plane release being validated and the source commit that provides the
reusable workflow entry point. A consumer caller pins both explicitly, so a
workflow implementation upgrade cannot silently upgrade the lifecycle release.
The caller passes no App credentials and does not replace repository-local
CI/CD.

The local repository is a new-history scaffold. Publication and organization
installation are separate operator actions.

Bootstrap is explicit and local:

```text
pnpm bootstrap:plan    # inspect the three managed files; writes nothing
pnpm bootstrap:apply   # create missing files and provenance lock
pnpm bootstrap:apply -- --force  # overwrite reviewed local conflicts
```

The command reads only paths declared in `manifests/workflow-bundle.json`.
It preflights every target before writing, refuses symbolic-link targets, and
writes `.agentic-delivery/distribution.lock.json` with the bundle pins and
source SHA-256 values. A conflict is never silently overwritten.

Organization Copilot agent publication is a separate explicit operation:

```text
pnpm agents:promote:plan
pnpm agents:promote
```

It reads only `agentic-delivery-primitives/agents/copilot/*.agent.md`, copies
those exact files into `.github-private/agents/`, and writes the publication
lock with the immutable Primitive source commit, content hash, ADRs, tool
policy, promotion release, compatibility targets, and timestamp. Stale
generated files are removed only when their previous lock hash still matches;
changed or unmanaged files stop the promotion.

The two preview Automation templates are similarly projected from the Control
Plane's canonical `automations/templates/` source into
`packages/agent-plugin/automations/`. `manifests/automation-projections.lock.json`
records the source commit and per-file hashes. The templates are manual and
read-only; VS Code users choose their local workspace, model, permissions,
enabled state, and schedule after import.

## Customizations repository-name migration

The staged capabilities lock uses schema version 2 and the explicit source
`agentic-delivery-lab/agentic-delivery-agent-customizations`, bound to repository
ID `1380894656`. Version 1 remains available for immutable historical locks.
The capability release ID, source commit and digest are unchanged. The
renamed source identity and explicit-name access have been read back, and the
digest reproduced using the exact pinned source tool. This draft does not admit a compatible full release composition,
activate participants or establish Copilot publication entitlement.

Agent-projection generation now emits publication lock version 2, with the
current name and repository ID on the lock and each record. It admits an old
version 1 lock only under its historical source identity for ownership checks.
The Control Plane version 2 publication reader and private caller updates must
be admitted before using these projections; version 1 is not silently treated
as version 2. Existing local checkout paths and the
`AGENTIC_DELIVERY_PRIMITIVES_ROOT` override remain supported while worktrees
are in use; repository names do not authorize moving another session's files.

The development hosting profile is recorded in `.github/rulesets/`. Its
mandatory main-branch PR/check rule has no bypass actors. A separate review
rule permits only `sjefsharp` (native user ID `14937399`) to use the approved
interactive development delegation through a pull request. Runner Apps do
not inherit that exception. Live readback is required before claiming these
files are enforcement. This reconciles the W13 prerequisite for current W05
administration; it does not activate unattended merging or prove runner
credential isolation.
