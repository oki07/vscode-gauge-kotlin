// Correctness rules only. Style is not enforced here: the point of this stage
// is to catch what `node --check` cannot - an undeclared identifier, a
// duplicated object key, an unreachable branch, a comparison that can never
// hold - in a codebase that is plain JavaScript with duck-typed option bags.
//
// A deliberately unused binding is named with a leading underscore, which is
// the convention the sources already follow for a swallowed `catch (_error)`.
export default [
  {
    ignores: ["out/**", "node_modules/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        exports: "writable",
        global: "readonly",
        globalThis: "readonly",
        module: "writable",
        process: "readonly",
        queueMicrotask: "readonly",
        require: "readonly",
        setImmediate: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-obj-calls": "error",
      "no-self-assign": "error",
      "no-sparse-arrays": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unsafe-negation": "error",
      "no-unused-vars": [
        "error",
        { args: "none", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
