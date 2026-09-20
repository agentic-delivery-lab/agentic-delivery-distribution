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
