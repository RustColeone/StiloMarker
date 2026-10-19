// The Cloud's elements on the page (the account controls, the file browser, the access dialog and hosting),
// looked up once when it starts. A missing one stops the start: the page and
// the code disagree.
function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing DOM node: ${selector}`);
  return node;
}

export function findElements() {
  return {
    accessBlacklist: query("#access-blacklist"),
    accessDialog: query("#access-dialog"),
    accessDialogTitle: query("#access-dialog-title"),
    accessStatus: query("#access-status"),
    accessWhitelist: query("#access-whitelist"),
    accountLockedNote: query("#account-locked-note"),
    accountLoginButton: query("#account-login-button"),
    accountLoginFields: query("#account-login-fields"),
    accountLoginRow: query("#account-login-row"),
    accountLogoutButton: query("#account-logout-button"),
    accountPasswordInput: query("#account-password-input"),
    accountSection: query("#account-login-row")?.closest(".settings-section"),
    accountStatusText: query("#account-status-text"),
    accountUsernameInput: query("#account-username-input"),
    browserAccessBtn: query("#browser-access-btn"),
    browserBreadcrumb: query("#browser-breadcrumb"),
    browserCopyBtn: query("#browser-copy-btn"),
    browserDeleteBtn: query("#browser-delete-btn"),
    browserList: query("#browser-list"),
    browserMoveBtn: query("#browser-move-btn"),
    browserNewFolder: query("#browser-new-folder"),
    browserNewProject: query("#browser-new-project"),
    browserOpenBtn: query("#browser-open-btn"),
    browserPickBtn: query("#browser-pick-btn"),
    browserPickCancel: query("#browser-pick-cancel"),
    browserPublishHere: query("#browser-publish-here"),
    browserSelectToggle: query("#browser-select-toggle"),
    browserSelectionLabel: query("#browser-selection-label"),
    browserSideLocal: query("#browser-side-local"),
    browserSideServer: query("#browser-side-server"),
    browserSideToggle: query("#browser-side-toggle"),
    browserStatus: query("#browser-status"),
    browserSubtitle: query("#browser-subtitle"),
    browserTitle: query("#browser-title"),
    browserTrash: query("#browser-trash"),
    collabHosting: query("#collab-hosting"),
    hostButton: query("#host-button"),
    hostPinText: query("#host-pin-text"),
    hostTeamSelect: query("#host-team-select"),
    openServerDialog: query("#open-server-dialog"),
    openServerLoginNote: query("#open-server-login-note"),
    pingServerButton: query("#ping-server-button"),
    serverBrowser: query("#server-browser"),
    serverUrlInput: query("#server-url-input")
  };
}
