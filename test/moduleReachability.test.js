const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_ROOT = path.join(__dirname, "..");
const SOURCE_ROOT = path.join(PRODUCT_ROOT, "src");
const ENTRY_POINT = path.join(SOURCE_ROOT, "extension.js");
const RELATIVE_REQUIRE = /require\((['"])(\.[^'"]+)\1\)/g;

function resolveRequire(fromFile, request) {
  const target = path.resolve(path.dirname(fromFile), request);
  for (const candidate of [target, `${target}.js`, path.join(target, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

function reachableFrom(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file) || !file.endsWith(".js")) {
      continue;
    }
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(RELATIVE_REQUIRE)) {
      const resolved = resolveRequire(file, match[2]);
      assert.ok(resolved, `${path.relative(PRODUCT_ROOT, file)} requires missing ${match[2]}`);
      pending.push(resolved);
    }
  }
  return seen;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

// `npm run bundle` starts at src/extension.js and follows require() from there,
// so a module no require() chain reaches is absent from out/extension.js and
// ships nothing, however well tested it is. Its consumers then branch on
// conditions the shipped extension can never meet.
test("every product module is reachable from the extension entry point", () => {
  const reachable = reachableFrom(ENTRY_POINT);
  const unreachable = sourceFiles(SOURCE_ROOT)
    .filter((file) => !reachable.has(file))
    .map((file) => path.relative(PRODUCT_ROOT, file))
    .sort();

  assert.deepEqual(unreachable, []);
});
