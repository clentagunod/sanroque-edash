# Stylesheet organization

- `global.css` — imported once in `src/main.tsx`. Pulls in the three
  files below, which every page depends on:
  - `base/tokens.css` — CSS custom properties (colors, spacing, shadows),
    the CSS reset, dark-mode-preload flash guard, and small global
    utility classes (`.visually-hidden`, focus rings, reduced motion).
  - `shell.css` — the shared authenticated-app shell and component
    library: sidebar, topbar, page container, stat cards, panels,
    tables, modals, toasts, the school-year switcher, and charts. Most
    pages are built entirely out of these shared classes, which is why
    they live in one place instead of being duplicated per page.
  - `responsive.css` — breakpoints for the shell + admin console above.
- `pages/*.css` — styles used by exactly one page. Each file is imported
  directly inside its matching page component (e.g.
  `src/pages/LoginPage.tsx` imports `src/styles/pages/login.css`), so it
  is only ever loaded when that page's lazy chunk is loaded.

When adding a new page: if it only uses existing shared classes from
`shell.css`, it needs no new stylesheet. If it needs its own one-off
styles, add `pages/<page-name>.css` and import it from that page's
component file — don't add to `shell.css` unless the styles are
genuinely reused by more than one page.
