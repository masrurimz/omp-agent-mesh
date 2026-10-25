// Compile-time seam for pi-messenger. Upstream ships TypeScript source with no
// bundled types, and that source does not type-check under this repo's strict
// settings. This declaration pins the one export we use; runtime behaviour is
// covered by scripts/smoke.ts.
declare module "pi-messenger" {
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
  const factory: (pi: ExtensionAPI) => void;
  export default factory;
}
