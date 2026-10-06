/**
 * Immediate loading shell for `/login`.
 *
 * The sign-in screen renders the setup flow, not the resident `AppShell`: a
 * `kade-shell` with the setup `SetupSidebar` (step list) plus the main content
 * column. This fallback mirrors that two-column structure with empty grey
 * shapes, and carries no resident nav, no Safe card, no footer text and no
 * data that could be mistaken for real content. See `PlainLoading` in
 * `src/app/loading.tsx`.
 */
export { PlainLoading as default } from '../loading';
