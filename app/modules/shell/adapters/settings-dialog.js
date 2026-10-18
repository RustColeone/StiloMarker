// The Settings dialog: its sections are pages in the "settings" tab host (any
// module adds one: addPage({ id, label, order, body })), and the
// fields in a section are declared by the module whose setting they change.
// Shell draws a declared field, keeps it in step with the setting, and saves
// what the user picks; the owner reacts to the setting changing
// (settings.on), whoever changed it.
//
//   fields.add({ page, id, order, label, key, control: "select" | "checkbox",
//                options?: [[value, label]], read?(settings) -> value,
//                write?(value) -> { key: value } })
//   fields.add({ page, id, order, render(container) })   a field its owner draws
//   addPage({ id, label, order, body, shown? })   body holds a [data-settings-fields] box
//   open(page?)  onOpen(listener(page))
export function createSettingsDialog({ pages, settings, registry, doc = globalThis.document }) {
  const dialog = doc?.querySelector("#settings-dialog");
  const strip = doc?.querySelector("#settings-tab-strip");
  const railButton = doc?.querySelector("#settings-tabs-button");
  const openListeners = new Set();
  const drawn = new Map(); // field id -> the control Shell drew
  const bodies = new Map(); // section id -> its body

  // On the phone the section rail is a flyout (≡): closed once a section is chosen.
  const setRail = (open) => {
    if (!dialog) return;
    dialog.dataset.tabs = open ? "open" : "closed";
    railButton?.setAttribute("aria-expanded", String(open));
  };
  railButton?.addEventListener("click", () => setRail(dialog.dataset.tabs !== "open"));
  pages.onChange("settings", () => setRail(false));
  // While the rail is open, a tap outside it only closes it: it must not reach
  // the half-covered control behind.
  dialog?.addEventListener("click", (event) => {
    if (dialog.dataset.tabs !== "open" || strip?.contains(event.target) || railButton?.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setRail(false);
  }, true);

  const read = (field) => (field.read ? field.read(settings) : settings[field.key]);
  const write = (field, value) => (field.write ? field.write(value) : { [field.key]: value });

  function control(field) {
    const label = doc.createElement("label");
    let input;
    if (field.control === "checkbox") {
      label.className = "checkbox-row";
      input = doc.createElement("input");
      input.type = "checkbox";
      const text = doc.createElement("span");
      text.textContent = field.label;
      label.append(input, text);
    } else {
      input = doc.createElement("select");
      for (const [value, text] of field.options ?? []) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
      label.append(doc.createTextNode(field.label), input);
    }
    input.id = field.id;
    input.addEventListener("change", () => {
      const value = field.control === "checkbox" ? input.checked : input.value;
      settings.change(write(field, value), `Settings: ${field.label}`);
    });
    drawn.set(field.id, { field, input });
    return label;
  }

  function show(field) {
    const entry = drawn.get(field.id);
    if (!entry) return;
    const value = read(field);
    if (field.control === "checkbox") entry.input.checked = Boolean(value);
    else entry.input.value = String(value ?? "");
  }

  // A section's fields, in order, in its `[data-settings-fields]` box.
  function drawPage(pageId) {
    const box = bodies.get(pageId)?.querySelector("[data-settings-fields]");
    if (!box) return;
    const fields = registry.all().filter((field) => field.page === pageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const field of fields) drawn.delete(field.id);
    box.replaceChildren(...fields.map((field) => {
      if (!field.render) return control(field);
      const holder = doc.createElement("div");
      holder.className = "settings-field";
      holder.dataset.field = field.id;
      field.render(holder);
      return holder;
    }));
    fields.forEach(show);
  }

  // Whoever changed a setting, its field shows the new value.
  settings.on((view, changed) => {
    for (const { field } of drawn.values()) if (changed.includes(field.key)) show(field);
  });

  function open(pageId) {
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (pageId) pages.show("settings", pageId);
    for (const { field } of drawn.values()) show(field);
    for (const listener of [...openListeners]) listener(pages.active("settings"));
  }

  return Object.freeze({
    open,
    close: () => dialog?.close(),
    isOpen: () => Boolean(dialog?.open),
    onOpen(listener) { openListeners.add(listener); return () => openListeners.delete(listener); },
    addPage(page) {
      bodies.set(page.id, page.body);
      const remove = pages.add({ ...page, host: "settings" });
      drawPage(page.id);
      return remove;
    },
    fields: {
      add(field) {
        const remove = registry.add(field);
        drawPage(field.page);
        return remove;
      }
    }
  });
}
