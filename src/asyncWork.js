"use strict";

function concurrencyLimit(value, fallback) {
  const limit = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, limit);
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const items = Array.from(values || []);
  if (items.length === 0) {
    return [];
  }
  const results = new Array(items.length);
  const limit = concurrencyLimit(concurrency, 1);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

module.exports = {
  concurrencyLimit,
  mapWithConcurrency,
};
