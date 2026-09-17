/**
 * Design tokens, lifted verbatim from the deployed MVP baseline.
 *
 * See docs/architecture/adr/0002-web-framework-and-design-system.md and
 * reference/mvp-onchainisland/README.md. The same values are declared as CSS
 * custom properties in globals.css; these constants are for inline styles,
 * which is where the reference expresses most of its spacing and colour.
 */
export const tokens = {
  brandPrimary: '#0063B5',
  action: '#0A7CFF',
  ink: '#101828',
  muted: '#667085',
  surface: '#FAFAFA',
  border: '#EAEDF1',
  activeNavBg: '#EAF2FC',
  success: '#1B7F5A',
  warning: '#B7791F',
  danger: '#B42318',
  locked: '#98A2B3',
  chipBg: '#F2F4F7',
  chipFg: '#344054',
  sidebarWidth: '240px',
  contentWidth: '1160px',
} as const;

export const fontFamily =
  "'Plus Jakarta Sans', var(--font-plus-jakarta), system-ui, sans-serif";
