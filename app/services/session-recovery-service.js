// An empty path is a valid workspace at the team root.
export function rememberedWorkspace(last) {
  if (!last?.team) return null;
  const path = last.path ?? (last.name ? `workspaces/${last.name}` : null);
  return typeof path === 'string' ? { team: last.team, path } : null;
}

// One recovery attempt at a time. A failed boot remains eligible for retries;
// foreground/online/manual events bring a waiting attempt forward immediately.
export function createSessionRecovery({ restore, enabled = () => true, onError = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let task = null, timer = null, attempts = 0, generation = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function run(options = {}) {
    clear();
    if (task) return task;
    if (!enabled()) return Promise.resolve(false);
    const epoch = generation;
    task = Promise.resolve().then(() => restore({ ...options, isCurrent: () => epoch === generation })).then(() => {
      attempts = 0;
      return true;
    }).catch(error => {
      if (epoch !== generation) return false;
      onError(error, options);
      // Rejected credentials/access require user action; network failures retry.
      if (![400, 401, 403, 404, 426, 499].includes(error?.status) && enabled()) {
        const delay = [1000, 2000, 5000, 10000, 30000][Math.min(attempts++, 4)];
        timer = setTimer(() => { timer = null; void run(); }, delay);
      }
      return false;
    }).finally(() => { task = null; });
    return task;
  }
  return { run, isPending: () => Boolean(task || timer !== null), cancel() { generation++; clear(); attempts = 0; } };
}
