/**
 * Provenance markers.
 *
 * The Week 1 contract requires that values absent from the build guide are not
 * silently presented as authoritative. Every non-obvious value in this package
 * carries one of these markers.
 *
 *   'documented'  - stated in docs/week-1-frozen-delivery-contract.md or
 *                   docs/planning/kade-mvp-build-document-v7.docx
 *   'external'    - taken from the issuing party's own published documentation
 *                   (for example Circle for USDC, EAS for the registry)
 *   'arbitrary'   - not present in either source; a demo placeholder that must
 *                   be confirmed at the corresponding human gate
 */
export type Provenance = 'documented' | 'external' | 'arbitrary';

export interface Sourced<T> {
  readonly value: T;
  readonly provenance: Provenance;
  readonly note?: string;
}

export function sourced<T>(value: T, provenance: Provenance, note?: string): Sourced<T> {
  return note === undefined ? { value, provenance } : { value, provenance, note };
}
