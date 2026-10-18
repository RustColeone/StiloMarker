// Legacy (before the module restructure): where Identity keeps the stored
// sign-in. The settings themselves are Shell's (shell.settings); the theme is
// Shell's to apply and the source font the Editor's.

// Where Identity keeps the account's stored sign-in: in these settings.
export function signInSettings(settings) {
  return {
    read: () => ({ username: settings.accountUsername, password: settings.accountPassword, proven: settings.accountSuccess }),
    write(stored) {
      settings.change({
        ...("username" in stored ? { accountUsername: stored.username } : {}),
        ...("password" in stored ? { accountPassword: stored.password } : {}),
        ...("proven" in stored ? { accountSuccess: stored.proven } : {})
      }, "the stored sign-in");
    }
  };
}
