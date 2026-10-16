// The app's modal dialogs (notice, confirm, input), toasts and copying text.
// Shell owns these page elements; nothing else queries them.

export function createDialogs(doc = document) {
  const el = (id) => doc.getElementById(id);
  const notice = { dialog: el("notice-dialog"), title: el("notice-dialog-title"), message: el("notice-dialog-message") };
  const confirmBox = {
    dialog: el("confirm-dialog"), title: el("confirm-dialog-title"),
    message: el("confirm-dialog-message"), accept: el("confirm-dialog-accept-button")
  };
  const input = {
    dialog: el("input-dialog"), title: el("input-dialog-title"), message: el("input-dialog-message"),
    label: el("input-dialog-label"), field: el("input-dialog-input"), keepSuffix: el("input-dialog-auto-ext"),
    keepSuffixRow: doc.querySelector(".input-dialog-ext-row"),
    submit: el("input-dialog-submit-button"), cancel: el("input-dialog-cancel-button")
  };

  function showNotice(message, title = "Message") {
    notice.title.textContent = title;
    notice.message.textContent = String(message);
    if (!notice.dialog.open) notice.dialog.showModal();
  }

  function showConfirm({ title = "Confirm Action", message, acceptLabel = "Confirm" }) {
    return new Promise((resolve) => {
      confirmBox.title.textContent = title;
      confirmBox.message.textContent = message;
      confirmBox.accept.textContent = acceptLabel;
      confirmBox.dialog.addEventListener("close", () => resolve(confirmBox.dialog.returnValue === "accept"), { once: true });
      confirmBox.dialog.showModal();
    });
  }

  // Asks for one line of text. `suffix` (e.g. ".md" for a rename) is kept out
  // of the field while "keep" is ticked, so it can't be edited by accident,
  // and put back on save. Resolves to the text, or null when cancelled.
  function showInput({ title = "Rename Item", message = "Enter a value.", label = "Name", value = "", submitLabel = "Save", suffix = "" }) {
    return new Promise((resolve) => {
      input.title.textContent = title;
      input.message.textContent = message;
      input.label.textContent = label;
      input.submit.textContent = submitLabel;
      const end = String(suffix || "");
      const hasSuffix = end.length > 0;
      const endsWithSuffix = (v) => v.toLowerCase().endsWith(end.toLowerCase());
      const strip = (v) => (hasSuffix && endsWithSuffix(v) ? v.slice(0, -end.length) : v);
      if (input.keepSuffixRow) input.keepSuffixRow.hidden = !hasSuffix;
      if (input.keepSuffix) input.keepSuffix.checked = hasSuffix;
      input.field.value = hasSuffix ? strip(value) : value;

      const onToggle = () => {
        if (!hasSuffix) return;
        const current = input.field.value;
        input.field.value = input.keepSuffix.checked ? strip(current) : (endsWithSuffix(current) ? current : `${current}${end}`);
      };
      const onCancel = () => input.dialog.close("cancel");
      const onClose = () => {
        input.cancel.removeEventListener("click", onCancel);
        input.keepSuffix?.removeEventListener("change", onToggle);
        let result = input.dialog.returnValue === "accept" ? input.field.value.trim() || null : null;
        if (result && hasSuffix && input.keepSuffix?.checked && !endsWithSuffix(result)) result = `${result}${end}`;
        resolve(result);
      };
      input.dialog.addEventListener("close", onClose, { once: true });
      input.cancel.addEventListener("click", onCancel);
      input.keepSuffix?.addEventListener("change", onToggle);
      input.dialog.showModal();
      input.field.focus();
      input.field.select();
    });
  }

  // Short feedback that never blocks; errors still use a notice.
  function showToast(message, { duration = 2200 } = {}) {
    const text = String(message ?? "").trim();
    const host = el("toast-host");
    if (!text || !host) return;
    const toast = doc.createElement("div");
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    host.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 400); // in case transitionend never fires
    }, duration);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const fallback = doc.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "readonly");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    doc.body.append(fallback);
    fallback.select();
    doc.execCommand("copy");
    fallback.remove();
  }

  return { showNotice, showConfirm, showInput, showToast, copyText };
}
