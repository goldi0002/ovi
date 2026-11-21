// Applies the saved theme before the first paint, so a dark page never flashes white.
// src/theme.ts does the same once the app runs; keep the two in step.
(function () {
  var choice = null;
  try {
    choice = localStorage.getItem("ovi.theme");
  } catch (e) {
    // Storage is blocked: follow the system.
  }
  if (choice !== "light" && choice !== "dark") choice = null;
  var dark = choice
    ? choice === "dark"
    : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  if (choice) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", dark ? "#141416" : "#f5f5f7");
  }
})();
