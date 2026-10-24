// Where Identity keeps the account's stored sign-in: in Shell's settings
// (accountUsername, accountToken, accountSuccess; accountPassword only as a
// page from before v0.3.1 left it).
export function signInSettings(settings) {
  return {
    read: () => ({ username: settings.accountUsername, token: settings.accountToken, password: settings.accountPassword, proven: settings.accountSuccess }),
    write(stored) {
      settings.change({
        ...("username" in stored ? { accountUsername: stored.username } : {}),
        ...("token" in stored ? { accountToken: stored.token } : {}),
        ...("password" in stored ? { accountPassword: stored.password } : {}),
        ...("proven" in stored ? { accountSuccess: stored.proven } : {})
      }, "the stored sign-in");
    }
  };
}
