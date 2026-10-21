// The app's modal dialogs (notice, confirm, input, form), toasts and copying text.
// Shell owns these page elements; nothing else queries them. A notice or a
// confirm given only its text takes its first sentence as the title (the
// rest is the message: model/dialog-text.js); a confirm's button says what it
// does (acceptLabel) and is red when it destroys something (danger).
import { splitQuestion } from "../model/dialog-text.js";

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

  // The title, and the message under it (none when it only says the title again).
  function words(box, title, message) {
    const said = title ? { title, message: String(message ?? "") } : splitQuestion(message, "Notice");
    box.title.textContent = said.title;
    box.message.textContent = said.message.trim() === said.title.trim() ? "" : said.message;
    box.message.hidden = !box.message.textContent;
  }

  function showNotice(message, title) {
    words(notice, title, message);
    if (!notice.dialog.open) notice.dialog.showModal();
  }

  function showConfirm({ title, message, acceptLabel = "OK", danger = false }) {
    return new Promise((resolve) => {
      const said = title ? { title, message } : splitQuestion(message);
      words(confirmBox, said.title, said.message);
      confirmBox.accept.textContent = acceptLabel;
      confirmBox.accept.classList.toggle("is-danger", Boolean(danger));
      confirmBox.dialog.addEventListener("close", () => resolve(confirmBox.dialog.returnValue === "accept"), { once: true });
      confirmBox.dialog.showModal();
    });
  }

  // Asks for one line of text. `suffix` (e.g. ".md" for a rename) is kept out
  // of the field while "keep" is ticked, so it can't be edited by accident,
  // and put back on save. Resolves to the text, or null when cancelled.
  function showInput({ title = "Rename", message = "", label = "Name", value = "", submitLabel = "Save", suffix = "" }) {
    return new Promise((resolve) => {
      words(input, title, message);
      input.label.textContent = label;
      input.submit.textContent = submitLabel;
      const end = String(suffix || "");
      const hasSuffix = end.length > 0;
      const endsWithSuffix = (v) => v.toLowerCase().endsWith(end.toLowerCase());
      const strip = (v) => (hasSuffix && endsWithSuffix(v) ? v.slice(0, -end.length) : v);
      if (input.keepSuffixRow) {
        input.keepSuffixRow.hidden = !hasSuffix;
        const text = input.keepSuffixRow.querySelector("span");
        if (text) text.textContent = `Keep ${end} at the end (out of the field, so it isn't changed by accident)`;
      }
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

  // Asks for several values at once. Each field: { name, label, value?,
  // type?: "text" | "url", multiline?: true, placeholder? }. The dialog is made on
  // first use; field elements are #form-dialog-field-<name>. Resolves to
  // { name: trimmed text } or null when cancelled.
  let form = null;
  function makeForm() {
    const dialog = doc.createElement("dialog");
    dialog.id = "form-dialog";
    dialog.className = "app-dialog";
    dialog.innerHTML = `<form method="dialog" class="app-dialog-form form-dialog-form">
        <header class="dialog-header"><div><div class="eyebrow"></div><h2 id="form-dialog-title"></h2></div>
          <p id="form-dialog-message" class="subtle-label"></p></header>
        <div class="form-dialog-fields"></div>
        <menu class="dialog-actions"><button value="cancel" type="submit" formnovalidate>Cancel</button>
          <button id="form-dialog-submit-button" class="is-primary" value="accept" type="submit">Save</button></menu>
      </form>`;
    doc.body.append(dialog);
    const pick = (selector) => dialog.querySelector(selector);
    return { dialog, eyebrow: pick(".eyebrow"), title: pick("h2"), message: pick("p"), fields: pick(".form-dialog-fields"), submit: pick("#form-dialog-submit-button") };
  }

  function showForm({ eyebrow = "", title, message = "", fields, submitLabel = "Save" }) {
    form ??= makeForm();
    return new Promise((resolve) => {
      form.eyebrow.textContent = eyebrow;
      form.eyebrow.hidden = !eyebrow;
      form.title.textContent = title;
      form.message.textContent = message;
      form.message.hidden = !message;
      form.submit.textContent = submitLabel;
      const inputs = fields.map((field) => {
        const label = doc.createElement("label");
        const caption = doc.createElement("span");
        caption.textContent = field.label;
        const control = doc.createElement(field.multiline ? "textarea" : "input");
        if (field.multiline) control.rows = 4;
        else control.type = field.type ?? "text";
        control.id = `form-dialog-field-${field.name}`;
        control.autocomplete = "off";
        control.placeholder = field.placeholder ?? "";
        control.value = field.value ?? "";
        label.append(caption, control);
        return { name: field.name, label, control };
      });
      form.fields.replaceChildren(...inputs.map((input) => input.label));
      form.dialog.addEventListener("close", () => {
        resolve(form.dialog.returnValue === "accept"
          ? Object.fromEntries(inputs.map((input) => [input.name, input.control.value.trim()]))
          : null);
      }, { once: true });
      form.dialog.returnValue = "";
      form.dialog.showModal();
      inputs[0]?.control.focus();
      inputs[0]?.control.select?.();
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

  return { showNotice, showConfirm, showInput, showForm, showToast, copyText };
}
