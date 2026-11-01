// @ts-check
/** Light/dark/system theme, remembered per browser. Storage may be blocked, so every access is guarded. */
const KEY = 'showup-theme';

/** @returns {'light'|'dark'|null} */
export function savedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme() {
  const t = savedTheme();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/** Flip between light and dark based on what is showing now. */
export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!savedTheme() && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* not remembered, still applied */
  }
  document.documentElement.dataset.theme = next;
  return next;
}
