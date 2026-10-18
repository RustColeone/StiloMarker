// A colour for each person in a session, the same everywhere they appear: their
// cursor in the editor, their dot in the status bar, their chip in Session.
// Chosen from a fixed palette by their session's client id. Pure.
const PALETTE = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

export function participantColor(clientId) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
