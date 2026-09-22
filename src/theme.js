// Applies a manual theme choice by setting data-theme on <html>. Leaving the
// attribute off lets the plain `prefers-color-scheme` media query in
// styles.css decide, which is what "System" means.
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
