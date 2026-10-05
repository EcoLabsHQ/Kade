/**
 * Immediate loading shell for `/login`.
 *
 * The sign-in screen does not render the resident `AppShell`, so this fallback
 * is deliberately shell-free: a neutral, centered placeholder with no sidebar,
 * no Safe card and no resident frame — and no text or data that could be
 * mistaken for real content. See `PlainLoading` in `src/app/loading.tsx`.
 */
export { PlainLoading as default } from '../loading';
