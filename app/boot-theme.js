// Before the app's modules load (a plain script in <head>): the theme the page
// showed last, so a dark or other theme does not flash Light first. Shell
// keeps it each time it applies one (app/modules/shell/adapters/theme.js) and
// applies the setting again once it starts; this only repeats what it kept.
(function () {
  try {
    var kept = JSON.parse(localStorage.getItem("mdnotes.theme.v1") || "null");
    if (!kept) return;
    var root = document.documentElement;
    // "System" follows the device as it is now.
    if (kept.setting === "system") {
      root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      return;
    }
    root.dataset.theme = kept.base === "dark" ? "dark" : "light";
    var colors = kept.colors || {};
    for (var token in colors) {
      if (/^[a-z0-9-]+$/.test(token) && typeof colors[token] === "string") root.style.setProperty("--" + token, colors[token]);
    }
  } catch (error) {
    console.debug("The theme shows once the app starts:", error && error.message);
  }
})();
