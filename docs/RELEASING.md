# Releasing

Releases are cut from git tags. Pushing a `v*` tag triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which runs
the unit tests, publishes the package to npm, and creates a GitHub Release with
auto-generated notes.

## Versioning

Standard [semver](https://semver.org), and — importantly — **the version is
never bumped in a feature PR.** Feature PRs change code; releases change the
version. Since 1.0.0 the tool names, input schemas, and output shapes are a
public contract, so a breaking change to any of them is a major bump:

| Change | Bump | Example |
| --- | --- | --- |
| Bug fix / hardening only | patch | `1.0.0 → 1.0.1` |
| New tool(s) / new capability (backward-compatible) | minor | `1.0.0 → 1.1.0` |
| Removing or renaming a tool, or changing its input/output contract | major | `1.0.0 → 2.0.0` |

The cadence is **release after each feature epic**: merge the epic's PR, then cut
a release at the appropriate level.

## Cutting a release

```bash
git checkout main && git pull

npm version patch          # or minor / major — bumps package.json + package-lock.json, commits, tags vX.Y.Z
git push --follow-tags     # pushes the commit and the tag -> Release workflow runs
```

`npm version` keeps the manifest, the lockfile, and the git tag in lockstep, so
they can never drift. The server's `serverInfo.version` reads from the same
manifest, so it moves too.

## Distribution

The package is published to npm as
[`@eargollo/vikunja-mcp`](https://www.npmjs.com/package/@eargollo/vikunja-mcp)
(the bare `vikunja-mcp` name is taken by an unrelated author, hence the scope).
Publishing is automatic: on a `v*` tag the Release workflow authenticates to npm
via **OIDC Trusted Publishing** — a short-lived GitHub identity token, so there's
no `NPM_TOKEN` secret to store or leak, and build provenance is attached
automatically. This requires the package's Trusted Publisher on npmjs.com to
point at this repo + `release.yml`. Users can then run it straight from the
registry with `npx @eargollo/vikunja-mcp`, or clone and run `node index.js` from
source (see the README).
