const THEME_STORAGE_KEY = "exam_system_theme";

function getTheme() {
  return document.documentElement.dataset.authTheme === "dark" ? "dark" : "light";
}

function updateToggleMeta(theme) {
  const toggle = document.querySelector("#authThemeToggle");
  if (!toggle) return;
  const isDark = theme === "dark";
  const key = isDark ? "theme.toLight" : "theme.toDark";
  const label = window.I18n ? window.I18n.t(key) : isDark ? "切换到明亮模式" : "切换到暗色模式";
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("title", label);
}

function setTheme(theme, persist = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.authTheme = nextTheme;
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      // ignore storage failures
    }
  }
  updateToggleMeta(nextTheme);
  window.dispatchEvent(new CustomEvent("auth-theme-change", { detail: { theme: nextTheme } }));
}

function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

updateToggleMeta(getTheme());

document.querySelector("#authThemeToggle")?.addEventListener("click", toggleTheme);

window.Theme = {
  getTheme,
  setTheme,
  toggleTheme,
  updateToggleMeta,
  STORAGE_KEY: THEME_STORAGE_KEY,
};

window.addEventListener("site-lang-change", () => {
  updateToggleMeta(getTheme());
});
