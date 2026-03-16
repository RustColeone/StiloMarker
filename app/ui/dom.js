function query(selector) {
  const node = document.querySelector(selector);
  if (!node) {
    throw new Error(`Missing DOM node: ${selector}`);
  }
  return node;
}

function promptForName(message, defaultValue = "") {
  const value = window.prompt(message, defaultValue)?.trim();
  return value || null;
}

function confirmAction(message) {
  return window.confirm(message);
}

function notify(message) {
  window.alert(message);
}

export { confirmAction, notify, promptForName, query };