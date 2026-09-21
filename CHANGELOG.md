# Changelog

## [Unreleased]

### Changed

- The draft bundle now pins Architecture `0.1.0-draft.3` at
  `d4714c9489fb14824ef0967903d34a73c3e437fb`, Primitive `0.1.0-draft.3` at
  `8d99a4a7a7240a02090ab2ac81cdb7676b8a42ad`, and Control Plane
  `0.2.0-draft.16` at `9e4ca88eb69a4df69067162d0fbc7100bd6cf691`.

- The draft bundle now pins Primitive release `0.1.0-draft.2` at
  `cfd86652d9f3a830c28d3dd40f6e762588c0af75` with its content digest, Control
  Plane release `0.2.0-draft.15` at `ce6a0144edeefbb8125962c06f70b9c9c91cde78`,
  and workflow source `d2bda1a0c8fc546a0ec3dc0e59809302cdf424e8`.

- The draft consumer bundle now pins Control Plane `0.2.0-draft.14` at
  `707a4a74c8d331f2400fffa2714f04b8a7d59b9b`, Architecture at
  `112a4163f7f8cb9142005568fb6270eef6df85cb`, and the reusable workflow
  source at `b64c8a3960614b4d0deb638c9ca8e5fca4d32c95`; the architecture
  review path now carries the pinned content-digest contract.

- The draft consumer bundle now pins Control Plane release commit
  `02b2727c582fc181a8622e86e0ed87b2e81c98f3` and workflow source commit
  `52e7a2092a1e7807ee091264a3dbbe97b8764593`, carrying downstream identity
  acceptance evidence through API, git, pull-request, and evidence projections.

- The draft consumer bundle now pins Control Plane release `0.2.0-draft.12`
  at `93583d371818045a9ae694b97e0cf90a4fae8956`; the workflow source pins
  runtime commit `3ea621d64507c0ef187181a487e5f8ff190e5aa3` and includes the
  deterministic origin lifecycle write-back acceptance check.

- The draft consumer bundle now pins the Control Plane acceptance release at
  `bd65b887eceb7162eb68235752eebf7d1e5edc59`; consumers gain the offline
  multi-repository identity and rollback contract through an explicit pin.
- The reusable workflow source now pins `83f164388096e0e343b1641c27ee399e509bf68b`,
  which includes the repository-independent acceptance validator while keeping
  the Control Plane release pin separate.

- The draft consumer bundle now pins Control Plane `0.2.0-draft.9` at
  `bfe2913c244dcaa3ff29aee18cac327ccbce44f0`; the central gateway requires an
  explicit controller repository ID and upgrades remain reviewable.
- The draft consumer bundle now pins Control Plane `0.2.0-draft.8` at
  `eeef545c40d5b9e9a590e335c5ab193deaaac928`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
