// The models a picker shows: grouped by provider when there is more than one,
// and which one is chosen.

// [[provider, [model, ...]], ...] in first-seen order; one group means no grouping.
export function groupByProvider(models, providerOf) {
  const groups = new Map();
  for (const name of models) {
    const group = providerOf(name) ?? "";
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  return [...groups];
}

// The saved choice while it is still offered, else the server's default, else the first.
export function chosenModel(models, saved, fallback) {
  return models.includes(saved) ? saved : (fallback ?? models[0] ?? null);
}
