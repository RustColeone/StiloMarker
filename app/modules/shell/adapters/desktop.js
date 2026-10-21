// The desktop build (desktop/): when the app runs in its window, the bridge
// its preload gives (window.stiloDesktop: the release, a newer one, its
// download page). There the service worker is not used (the files are the
// app's own); updates come from the release feed instead.
const LOOK_EVERY = 6 * 60 * 60 * 1000;

export const desktopBridge = (win = globalThis.window) => win?.stiloDesktop ?? null;

// onUpdate({ version, url }) once a newer release is out: at start, then every few hours.
export function watchReleases({ bridge, onUpdate, log, every = LOOK_EVERY }) {
  let told = null;
  const look = async () => {
    const update = await bridge.checkForUpdate().catch((error) => {
      log("Looking for a newer release failed", error?.message ?? String(error));
      return null;
    });
    if (update?.available && update.version !== told) {
      told = update.version;
      onUpdate(update);
    }
  };
  void look();
  const timer = setInterval(look, every);
  return () => clearInterval(timer);
}
