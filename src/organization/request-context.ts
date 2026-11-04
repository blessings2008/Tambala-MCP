import { AsyncLocalStorage } from 'node:async_hooks';

export type McpRequestPrincipal =
  | { kind: 'oauth'; clientId: string }
  | { kind: 'legacy-shared-token' }
  | { kind: 'unknown' };

const requestPrincipal = new AsyncLocalStorage<McpRequestPrincipal>();

/** Execute one HTTP request with its verified transport principal attached to async context. */
export function runWithRequestPrincipal<T>(
  principal: McpRequestPrincipal,
  callback: () => T,
): T {
  return requestPrincipal.run(principal, callback);
}

/** Read the principal established by the HTTP authentication layer. Never accepts tool arguments. */
export function getRequestPrincipal(): McpRequestPrincipal {
  return requestPrincipal.getStore() ?? { kind: 'unknown' };
}
