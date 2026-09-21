# Changelog

## [Unreleased]

### Changed

- The draft consumer bundle now pins Control Plane `0.2.0-draft.7` at
  `48bc83b2c52e0d9aeee47905d4877ba75657c354`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
