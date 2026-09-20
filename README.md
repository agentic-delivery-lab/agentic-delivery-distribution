# Agentic Delivery Distribution

This repository packages the executable developer environment and thin
consumer integration for Agentic Delivery:

- Dev Container and Feature definitions;
- idempotent bootstrap into a consumer repository;
- reusable workflow callers pinned to an immutable Control Plane commit; and
- Agent Plugin projections from approved Primitive and Automation releases.

The package does not contain the generic lifecycle, routing state machine,
organization credentials, or canonical agent/skill implementations.

The local repository is a new-history scaffold. Publication and organization
installation are separate operator actions.
