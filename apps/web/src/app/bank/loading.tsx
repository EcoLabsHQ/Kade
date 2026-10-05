/**
 * Immediate loading shell for `/bank`.
 *
 * The route is auth-gated and `force-dynamic`; the shared `RouteLoading` shell
 * renders the frame with neutral placeholders only and does not read any data
 * or bypass the session gate. See `src/app/loading.tsx` for the honesty and
 * layout rationale.
 */
export { RouteLoading as default } from '../loading';
