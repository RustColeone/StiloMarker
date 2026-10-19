// Where Identity keeps the account's stored sign-in: in Shell's settings
// (accountUsername, accountPassword, accountSuccess).
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
