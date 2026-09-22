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

// Same idea for the accent colour. 'green' is the default baked into :root,
// so no attribute is needed for it.
export function applyAccent(accent) {
  if (accent === 'blue' || accent === 'violet') {
    document.documentElement.setAttribute('data-accent', accent);
  } else {
    document.documentElement.removeAttribute('data-accent');
  }
}
