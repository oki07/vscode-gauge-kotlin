# Execution Project Kind

## Behavior

When Maven and Gradle build files coexist, execution args must match the project returned by the project factory.

## RED

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "Maven args when Maven and Gradle files coexist"
```

Result: failed. The command was Maven, but args were Gradle args.

## GREEN

Command:

```sh
node --test test/execution/executor.test.js --test-name-pattern "Maven args when Maven and Gradle files coexist"
```

Result: passed.
