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
