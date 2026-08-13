(function () {
  var root = document.documentElement;
  var themeBtn = document.getElementById("themeBtn");
  if (!themeBtn) return;

  function storedTheme() {
    try { return localStorage.getItem("tabwall-manual-theme"); } catch (e) { return null; }
  }

  function applyTheme(theme) {
    var next = theme === "light" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    themeBtn.textContent = next === "light" ? "深色" : "淺色";
    themeBtn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
    try { localStorage.setItem("tabwall-manual-theme", next); } catch (e) {}
  }

  applyTheme(storedTheme() || "dark");
  themeBtn.addEventListener("click", function () {
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
})();
