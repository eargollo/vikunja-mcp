# Releasing

Releases are cut from git tags. Pushing a `v*` tag triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs
the unit tests and publishes a GitHub Release with auto-generated notes.

## Versioning

Standard [semver](https://semver.org), and — importantly — **the version is
never bumped in a feature PR.** Feature PRs change code; releases change the
version. While the project is pre-1.0:

| Change | Bump | Example |
| --- | --- | --- |
| Bug fix / hardening only | patch | `0.1.0 → 0.1.1` |
| New tool(s) / new capability | minor | `0.1.0 → 0.2.0` |
| Removing or renaming a tool, or changing its input contract | minor (pre-1.0) | `0.1.0 → 0.2.0` |

The cadence is **release after each feature epic**: merge the epic's PR, then cut
a minor release.

## Cutting a release

```bash
git checkout main && git pull

npm version minor          # bumps package.json + package-lock.json, commits, tags vX.Y.Z
git push --follow-tags     # pushes the commit and the tag -> Release workflow runs
```

`npm version` keeps the manifest, the lockfile, and the git tag in lockstep, so
they can never drift. The server's `serverInfo.version` reads from the same
manifest, so it moves too.

### First release (`v0.1.0`)

The manifest already sits at the target version, so there's nothing to bump —
tag the current `main` directly:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Distribution

Distribution is **GitHub-only**: users clone the repo and run `node index.js`
(see the README). The npm package name `vikunja-mcp` is taken by an unrelated
author, so this project is scoped as `@eargollo/vikunja-mcp`. To also publish to
the npm registry, add an `NPM_TOKEN` repo secret and uncomment the publish block
in the Release workflow — `publishConfig.access` is already `public`.
