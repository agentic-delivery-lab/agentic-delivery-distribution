# Changelog

## [Unreleased]

### Changed

- The draft consumer bundle now pins Control Plane `0.2.0-draft.4` at
  `ff4b2198a04ed695942faeec4e838a628b1b2ed4`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
