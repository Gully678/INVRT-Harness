import type { ResolveManagedRouteInput, RoutingAuthorityPort } from "@t3tools/contracts";
import * as Context from "effect/Context";

/**
 * Caller-supplied local authority for one websocket intake.
 * The port is an in-memory fixture or a future local adapter. It is not the installed FORGE pack.
 * A task without a port fails closed. No task keeps ordinary message.dispatch on today's path.
 */
export interface LocalRoutingAuthorityShape {
  readonly port?: RoutingAuthorityPort | undefined;
  readonly task?: Omit<ResolveManagedRouteInput, "port"> | undefined;
}

export class LocalRoutingAuthority extends Context.Reference<LocalRoutingAuthorityShape>(
  "t3/ws/LocalRoutingAuthority",
  { defaultValue: () => ({}) },
) {}

export const messageIntakeContext = <Services>(
  services: Context.Context<Services>,
  local?: LocalRoutingAuthorityShape,
): Context.Context<Services | LocalRoutingAuthority> => {
  const supplied = local ?? {};
  return Context.add(services, LocalRoutingAuthority, {
    ...(supplied.port === undefined ? {} : { port: supplied.port }),
    ...(supplied.task === undefined ? {} : { task: supplied.task }),
  });
};
