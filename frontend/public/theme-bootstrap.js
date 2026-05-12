(function () {
  try {
    var saved = localStorage.getItem("superdoc-theme");
    var theme = saved === "dark" ? "dark" : "azure";
    var root = document.documentElement;
    root.classList.add("theme-" + theme);
    root.setAttribute("data-theme", theme);
    if (theme === "dark") root.classList.add("dark");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0c0c0e" : "#0b70d8");
  } catch (e) {}
})();
