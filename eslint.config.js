// ESLint flat config — security-focused static linting for the server sources.
//
// NOTE: eslint and eslint-plugin-security are intentionally NOT project
// dependencies. This repo's whole point is a minimal, self-owned tree (one
// runtime dep, no devDeps), so the lint job installs them ephemerally in CI
// (pinned, --no-save) and this config is only consulted there or via a manual
// `npx eslint`. Nothing here ships in the published package.
import security from "eslint-plugin-security";

export default [
  {
    files: ["index.js", "api.js", "lib.js", "tools.js"],
    plugins: { security },
    languageOptions: {
      ecmaVersion: "latest", // import attributes (`with { type: "json" }`)
      sourceType: "module",
    },
    rules: {
      ...security.configs.recommended.rules,
      // detect-object-injection flags every `obj[key]` access as a potential
      // prototype-pollution/injection sink. In this codebase the adversarial
      // audit confirmed all such accesses use validated ints / allow-listed
      // enums / known literal keys and never merge attacker keys into a
      // prototype — so it is pure noise here. Keep the other rules strict.
      "security/detect-object-injection": "off",
      // detect-possible-timing-attacks fires purely on the variable NAME
      // `secret`; our only uses are presence checks (`secret !== undefined`),
      // not constant-time secret comparisons, so there is no timing channel.
      "security/detect-possible-timing-attacks": "off",
    },
  },
];
