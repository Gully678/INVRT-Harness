import type { ModelSelection, PolicyRoute } from "@t3tools/contracts";
import * as Context from "effect/Context";

/** Trusted route for the duration of one managed dispatch. */
export class ManagedRouteConstraint extends Context.Reference<PolicyRoute | undefined>(
  "t3/orchestration-v2/ManagedRouteConstraint",
  { defaultValue: () => undefined },
) {}

export function matchesManagedRoute(route: PolicyRoute, selection: ModelSelection): boolean {
  const efforts =
    selection.options?.filter(
      (option) => option.id === "effort" || option.id === "reasoningEffort",
    ) ?? [];
  return (
    selection.instanceId === route.providerInstanceRef &&
    selection.model === route.model &&
    efforts.length <= 1 &&
    (efforts[0]?.value ?? null) === route.effort
  );
}
