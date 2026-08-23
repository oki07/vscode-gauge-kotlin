"use strict";

const STOPPED_REQUEST = Symbol("stopped request");

function cleanupSource(source, cancel) {
  if (!source) {
    return;
  }
  if (cancel && typeof source.cancel === "function") {
    try {
      source.cancel();
    } catch (_error) {
      // Continue disposing the owned source.
    }
  }
  if (typeof source.dispose === "function") {
    try {
      source.dispose();
    } catch (_error) {
      // Disposal is best-effort during terminal cleanup.
    }
  }
}

function createLspRequestOwner(neutralValue) {
  const activeOperations = new Set();
  let disposed = false;

  function operationStopped(operation) {
    return disposed || !operation || operation.stopped;
  }

  function releaseSource(operation, cancel = false) {
    if (!operation || !operation.source) {
      return;
    }
    const source = operation.source;
    operation.source = undefined;
    cleanupSource(source, cancel);
  }

  function stopOperation(operation) {
    if (!operation || operation.stopped) {
      return;
    }
    operation.stopped = true;
    activeOperations.delete(operation);
    operation.resolveCancellation(STOPPED_REQUEST);
    releaseSource(operation, true);
  }

  function createSource(operation, CancellationTokenSource) {
    if (operationStopped(operation) || typeof CancellationTokenSource !== "function") {
      return undefined;
    }
    const source = new CancellationTokenSource();
    if (operationStopped(operation)) {
      cleanupSource(source, true);
      return undefined;
    }
    operation.source = source;
    return source;
  }

  function run(work) {
    if (disposed) {
      return Promise.resolve(neutralValue);
    }

    let resolveCancellation;
    const cancellation = new Promise((resolve) => {
      resolveCancellation = resolve;
    });
    const operation = {
      cancellation,
      resolveCancellation,
      source: undefined,
      stopped: false,
    };
    activeOperations.add(operation);

    let workValue;
    try {
      workValue = work(operation);
    } catch (error) {
      activeOperations.delete(operation);
      releaseSource(operation);
      if (operationStopped(operation)) {
        return Promise.resolve(neutralValue);
      }
      return Promise.reject(error);
    }

    return Promise.race([Promise.resolve(workValue), cancellation])
      .then(
        (value) => (
          value === STOPPED_REQUEST || operationStopped(operation)
            ? neutralValue
            : value
        ),
        (error) => {
          if (operationStopped(operation)) {
            return neutralValue;
          }
          throw error;
        },
      )
      .finally(() => {
        activeOperations.delete(operation);
        releaseSource(operation);
      });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    const operations = [...activeOperations];
    activeOperations.clear();
    for (const operation of operations) {
      stopOperation(operation);
    }
  }

  return {
    createSource,
    dispose,
    operationStopped,
    run,
  };
}

module.exports = {
  createLspRequestOwner,
};
