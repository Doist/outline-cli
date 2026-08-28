## [2.0.3](https://github.com/Doist/outline-cli/compare/v2.0.2...v2.0.3) (2026-08-28)

### Bug Fixes

* **deps:** update dependency chalk to v6 ([#107](https://github.com/Doist/outline-cli/issues/107)) ([0cff6e4](https://github.com/Doist/outline-cli/commit/0cff6e4b7e7718047fe7178172a6fd6218c67927))

## [2.0.2](https://github.com/Doist/outline-cli/compare/v2.0.1...v2.0.2) (2026-08-28)

### Bug Fixes

* **deps:** update dependency commander to v15 ([#108](https://github.com/Doist/outline-cli/issues/108)) ([3f82933](https://github.com/Doist/outline-cli/commit/3f82933964955c588caf54515d4a1f75d99ffa2e))
* **deps:** update dependency open to v11 ([#109](https://github.com/Doist/outline-cli/issues/109)) ([23d2525](https://github.com/Doist/outline-cli/commit/23d2525f3c91f547369b2d07cc79a5240ac07274))

## [2.0.1](https://github.com/Doist/outline-cli/compare/v2.0.0...v2.0.1) (2026-08-28)

### Bug Fixes

* **deps:** pin dependency undici to 7.29.0 ([#94](https://github.com/Doist/outline-cli/issues/94)) ([1049dec](https://github.com/Doist/outline-cli/commit/1049dec715dd77ecb6621cebe068b3a06a5d2d89))
* **deps:** update dependency marked to v18.0.10 ([#100](https://github.com/Doist/outline-cli/issues/100)) ([b57defd](https://github.com/Doist/outline-cli/commit/b57defd917f1e63a765baf13b04832cfe87899fd))
* **deps:** update dependency oauth4webapi to v3.8.7 ([#101](https://github.com/Doist/outline-cli/issues/101)) ([5e456b7](https://github.com/Doist/outline-cli/commit/5e456b7cd2a0966c72b28e533b6ab564d38ca6b6))

## [2.0.0](https://github.com/Doist/outline-cli/compare/v1.10.5...v2.0.0) (2026-08-27)

### ⚠ BREAKING CHANGES

* update @doist/cli-core to 1.4.0 and require Node 24 (#93)

### Features

* update @doist/cli-core to 1.4.0 and require Node 24 ([#93](https://github.com/Doist/outline-cli/issues/93)) ([e695029](https://github.com/Doist/outline-cli/commit/e6950291d895133887505c67c984601825320407))

## [1.10.5](https://github.com/Doist/outline-cli/compare/v1.10.4...v1.10.5) (2026-08-27)

### Bug Fixes

* pair the undici dispatcher with its own fetch and bump to 7.29.0 ([#92](https://github.com/Doist/outline-cli/issues/92)) ([173d857](https://github.com/Doist/outline-cli/commit/173d857df858615b81e7d903630fdd379eb93db6))

## [1.10.4](https://github.com/Doist/outline-cli/compare/v1.10.3...v1.10.4) (2026-07-29)

### Bug Fixes

* set Comms audience to thread ([#90](https://github.com/Doist/outline-cli/issues/90)) ([c54be07](https://github.com/Doist/outline-cli/commit/c54be07e95c7c63f29a84d0e51b16673a0e5f519))

## [1.10.3](https://github.com/Doist/outline-cli/compare/v1.10.2...v1.10.3) (2026-07-01)

### Bug Fixes

* **docs:** Update readme with correct token command ([#88](https://github.com/Doist/outline-cli/issues/88)) ([8bfe8a0](https://github.com/Doist/outline-cli/commit/8bfe8a0d4f5a7b8e1be8a5bef1de3c6661cfd205))

## [1.10.2](https://github.com/Doist/outline-cli/compare/v1.10.1...v1.10.2) (2026-06-09)

### Bug Fixes

* build a working dispatcher on runtimes without undici's decompress interceptor (e.g. Bun) ([#84](https://github.com/Doist/outline-cli/issues/84)) ([c2c69d2](https://github.com/Doist/outline-cli/commit/c2c69d2f1c9eddb08f3f2b0d8236d93770219203))

## [1.10.1](https://github.com/Doist/outline-cli/compare/v1.10.0...v1.10.1) (2026-06-08)

### Bug Fixes

* pin undici to 7.24.8 and block renovate updates ([#82](https://github.com/Doist/outline-cli/issues/82)) ([1f7cdc9](https://github.com/Doist/outline-cli/commit/1f7cdc9d575d1f99968b088abbeafd9182e52c84))

## [1.10.0](https://github.com/Doist/outline-cli/compare/v1.9.0...v1.10.0) (2026-05-24)

### Features

* **auth:** add `token` command group (save + view) ([#80](https://github.com/Doist/outline-cli/issues/80)) ([99789cc](https://github.com/Doist/outline-cli/commit/99789cc48b9afa9fc53959427f9121f8d3c12cd9))

## [1.9.0](https://github.com/Doist/outline-cli/compare/v1.8.0...v1.9.0) (2026-05-24)

### Features

* **account:** account command group (cli-core attachers) ([#79](https://github.com/Doist/outline-cli/issues/79)) ([01bd6a6](https://github.com/Doist/outline-cli/commit/01bd6a60af135bbfda894b56d5a6d2b2229b70a8)), closes [#77](https://github.com/Doist/outline-cli/issues/77)

## [1.8.0](https://github.com/Doist/outline-cli/compare/v1.7.0...v1.8.0) (2026-05-21)

### Features

* **auth:** silent OAuth token refresh ([#75](https://github.com/Doist/outline-cli/issues/75)) ([83996d5](https://github.com/Doist/outline-cli/commit/83996d56810e28e608d91a981fd3b313dcdeb4d3))

## [1.7.0](https://github.com/Doist/outline-cli/compare/v1.6.0...v1.7.0) (2026-05-17)

### Features

* **auth:** store API tokens in the OS keyring via @doist/cli-core ([#73](https://github.com/Doist/outline-cli/issues/73)) ([b353aea](https://github.com/Doist/outline-cli/commit/b353aeae3cdcc63308ec8de899f08c1dda23f22c))

## [1.6.0](https://github.com/Doist/outline-cli/compare/v1.5.3...v1.6.0) (2026-05-15)

### Features

* **auth:** adopt cli-core 0.12.0 multi-user TokenStore shape ([#71](https://github.com/Doist/outline-cli/issues/71)) ([53487b7](https://github.com/Doist/outline-cli/commit/53487b707b9a980c401ef19b3e37c08299aa6abe))

## [1.5.3](https://github.com/Doist/outline-cli/compare/v1.5.2...v1.5.3) (2026-05-11)

### Bug Fixes

* `ol --version` shows the wrong version ([#60](https://github.com/Doist/outline-cli/issues/60)) ([3ed8b10](https://github.com/Doist/outline-cli/commit/3ed8b10d19d727c131b87b2dc6939b5ab0b04a09))

## [1.5.2](https://github.com/Doist/outline-cli/compare/v1.5.1...v1.5.2) (2026-05-09)

### Bug Fixes

* decompress gzipped responses on Node 24+ (undici 7) ([#63](https://github.com/Doist/outline-cli/issues/63)) ([c44fbea](https://github.com/Doist/outline-cli/commit/c44fbeaafa13489505e70d1f829454982f24e07d))

## [1.5.1](https://github.com/Doist/outline-cli/compare/v1.5.0...v1.5.1) (2026-04-02)

### Bug Fixes

* secure config permissions and address update channel review feedback ([#53](https://github.com/Doist/outline-cli/issues/53)) ([63e64f8](https://github.com/Doist/outline-cli/commit/63e64f8b3e54251b74c11f8cbf100339422d43dc))

## [1.5.0](https://github.com/Doist/outline-cli/compare/v1.4.0...v1.5.0) (2026-04-02)

### Features

* allow switching between stable and pre-release update channels ([#52](https://github.com/Doist/outline-cli/issues/52)) ([6834688](https://github.com/Doist/outline-cli/commit/683468819423e93b3f1ca8b38af9ce6788a2e675))

## [1.4.0](https://github.com/Doist/outline-cli/compare/v1.3.0...v1.4.0) (2026-04-02)

### Features

* add `ol changelog` command ([#50](https://github.com/Doist/outline-cli/issues/50)) ([60656e5](https://github.com/Doist/outline-cli/commit/60656e5d816af6080f5084e3f44d0d9763e6c354))

## [1.3.0](https://github.com/Doist/outline-cli/compare/v1.2.1...v1.3.0) (2026-04-02)

### Features

* add `ol update` command ([#49](https://github.com/Doist/outline-cli/issues/49)) ([fa5608e](https://github.com/Doist/outline-cli/commit/fa5608ea50392a71150f7d1140204f0160680d8a))

## [1.2.1](https://github.com/Doist/outline-cli/compare/v1.2.0...v1.2.1) (2026-03-31)

### Bug Fixes

* Capture previous tag before release ([#45](https://github.com/Doist/outline-cli/issues/45)) ([6a00294](https://github.com/Doist/outline-cli/commit/6a002949587a17313f96bc2fb1a93fba7e605e9b))

## [1.2.0](https://github.com/Doist/outline-cli/compare/v1.1.0...v1.2.0) (2026-03-30)

### Features

* Announce releases on Twist ([#44](https://github.com/Doist/outline-cli/issues/44)) ([5e2f86b](https://github.com/Doist/outline-cli/commit/5e2f86b9bf20ca97b50df74f0552028b6f6b94b2))

# [1.1.0](https://github.com/Doist/outline-cli/compare/v1.0.2...v1.1.0) (2026-03-27)


### Features

* add --parent option to doc create and doc move ([#41](https://github.com/Doist/outline-cli/issues/41)) ([2514b06](https://github.com/Doist/outline-cli/commit/2514b06e097938b1c0833ea2147509fa0916be28))

## [1.0.2](https://github.com/Doist/outline-cli/compare/v1.0.1...v1.0.2) (2026-03-26)


### Bug Fixes

* honor proxy env vars by default ([#33](https://github.com/Doist/outline-cli/issues/33)) ([5bb8e77](https://github.com/Doist/outline-cli/commit/5bb8e77fa8cabe17d2cba478a01c1c64957d7f6b))

## [1.0.1](https://github.com/Doist/outline-cli/compare/v1.0.0...v1.0.1) (2026-03-25)


### Bug Fixes

* correct skill name and quote YAML description ([#38](https://github.com/Doist/outline-cli/issues/38)) ([e0e4fa4](https://github.com/Doist/outline-cli/commit/e0e4fa435dcfc89b1e29e4b8d02d6ba911dfdb7f))

# 1.0.0 (2026-03-25)

### Bug Fixes

- broaden CI detection to handle all truthy values ([7dc2806](https://github.com/Doist/outline-cli/commit/7dc2806a344d8be841fb9fae80dce59dc6667fac))
- exclude dist from biome checks ([0dc49a3](https://github.com/Doist/outline-cli/commit/0dc49a38515ae75005f253413b171c6c6b48e99a))

### Features

- add API Spinner Proxy ([#17](https://github.com/Doist/outline-cli/issues/17)) ([a3bc75a](https://github.com/Doist/outline-cli/commit/a3bc75afaf81b684703b0e821d5fec0cf05a29cb))
- add fuzzy reference resolution ([#19](https://github.com/Doist/outline-cli/issues/19)) ([6c1c6f9](https://github.com/Doist/outline-cli/commit/6c1c6f97762809ddf3e4d912892c3582cf9f8b36))
- add npm publishing, new agent skills, and skill auto-update ([#36](https://github.com/Doist/outline-cli/issues/36)) ([bcb2e75](https://github.com/Doist/outline-cli/commit/bcb2e7593447ca35069316636cbfda02bb86fb91)), closes [Doist/todoist-cli#176](https://github.com/Doist/todoist-cli/issues/176) [Doist/bob-cli#17](https://github.com/Doist/bob-cli/issues/17) [Doist/twist-cli#101](https://github.com/Doist/twist-cli/issues/101)
- add structured error formatting with codes and hints ([#18](https://github.com/Doist/outline-cli/issues/18)) ([17658d2](https://github.com/Doist/outline-cli/commit/17658d2a66d30939146b1fb5625782df122ff315))
- implement OAuth PKCE browser login ([#20](https://github.com/Doist/outline-cli/issues/20)) ([b7f6eec](https://github.com/Doist/outline-cli/commit/b7f6eec84250b6d8ceea5e5f1b282bdb550b8092)), closes [#7](https://github.com/Doist/outline-cli/issues/7) [outline/outline#11254](https://github.com/outline/outline/issues/11254)
- improve oauth login inputs and callback UX ([#31](https://github.com/Doist/outline-cli/issues/31)) ([3011b28](https://github.com/Doist/outline-cli/commit/3011b28a2f3a0b04460ad8def9ed39426b7a1df3))
