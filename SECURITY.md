# Security Policy

## Supported versions

The latest published `@eargollo/vikunja-mcp` release on npm receives security
fixes. There is no long-term support for older majors — upgrade to the newest
release before reporting.

## Reporting a vulnerability

Please report vulnerabilities **privately**, not via a public issue or PR.

- Preferred: open a private advisory through GitHub's
  [Report a vulnerability](https://github.com/eargollo/vikunja-mcp/security/advisories/new)
  form (Security → Advisories on the repo).
- Alternatively, email <eargollo@gmail.com> with details.

Please include enough to reproduce: version, `VIKUNJA_MCP_ALLOW_WRITE` /
`VIKUNJA_MCP_ALLOW_DELETE` state, the tool call and arguments, and the observed
vs. expected behavior. A proof-of-concept helps but is not required.

Expect an initial acknowledgement within a few days. Once a fix is ready it ships
in a patch release and the advisory is published with credit, unless you prefer
to remain anonymous.

## Scope & trust posture

This server is deliberately minimal (see the README's "Why this exists"): one
direct dependency, a single network egress point in `api.js`, and read + additive
tools only unless write/delete tiers are explicitly enabled via environment
flags. Reports that strengthen that posture — an unintended egress path, a tool
that escapes its tier, or a credential leak into logs — are especially welcome.
