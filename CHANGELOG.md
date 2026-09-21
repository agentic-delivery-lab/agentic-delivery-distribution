# Changelog

## [Unreleased]

### Changed

- The draft consumer bundle now pins Control Plane `0.2.0-draft.6` at
  `564a35fd798e75800a3bf15223afb8bd87d59581`; upgrades remain explicit and
  rollbackable through the bundle manifest.
- The draft consumer bundle now pins the first locally validated Control Plane commit, including its central intake path fix, instead of a pre-contract commit that lacks the release validators.

### Added

- Added the reproducible Dev Container, Feature, bootstrap, workflow-caller,
  and Agent Plugin distribution scaffold.
