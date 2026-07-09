# TextMate Escaped Argument Starts

## Scope

- Reference source: `references/gauge/parser/stepParser.go`
- Target source: `syntaxes/gauge.tmLanguage.json`
- Target source: `syntaxes/gauge-concept.tmLanguage.json`
- Test source: `test/manifest.test.js`

## RED

Command:

```sh
node --test test/manifest.test.js
```

Result:

- Failed 3 tests.
- `Gauge TextMate grammar handles table and argument lexer edge cases`
- `Gauge TextMate grammar keeps only dynamic arguments reachable in hash concept headings`
- `Gauge Concept TextMate grammar ignores escaped argument starts`

Reason:

- TextMate dynamic, static, and table argument patterns matched argument starts that were escaped with a backslash.

## GREEN

Command:

```sh
node --test test/manifest.test.js
```

Result:

- Passed 15 tests.

Implementation:

- Added a backslash lookbehind guard to Gauge and Concept TextMate argument start patterns.
