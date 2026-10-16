// Fills in the parts of the page that list file types, so index.html never
// spells one. The page marks what it needs:
//   <input type="file" data-file-accept="all" | "images" [data-file-accept-extra=".zip">
//   <… data-file-types="supported">        gets "Supported: .md, .mtree, …."
//   <select data-file-type-options="create"> gets one option per creatable type

export function fillPage(doc, table) {
  const images = table.all().filter((t) => t.kind === "image").flatMap((t) => Object.keys(t.extensions));
  for (const input of doc.querySelectorAll("[data-file-accept]")) {
    const base = input.dataset.fileAccept === "images" ? images.join(",") : table.accept();
    input.accept = [base, input.dataset.fileAcceptExtra].filter(Boolean).join(",");
  }
  for (const el of doc.querySelectorAll('[data-file-types="supported"]')) {
    el.textContent = `Supported: ${table.describe()}.`;
  }
  for (const select of doc.querySelectorAll('select[data-file-type-options="create"]')) {
    const chosen = select.value;
    select.replaceChildren(...table.creatable().map((type) => {
      const option = doc.createElement("option");
      option.value = type.id;
      option.textContent = `${type.label} (${Object.keys(type.extensions)[0]})`;
      return option;
    }));
    if (chosen && [...select.options].some((o) => o.value === chosen)) select.value = chosen;
  }
}
