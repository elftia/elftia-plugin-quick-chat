import type {
  AgentBackendHostApi,
  HostCapabilityEndpoint,
  HostCapabilityProvided,
  HostInjectedCapabilityContext,
  HostQuickChatSurfaceLike,
  HostWireValue,
} from '@elftia/plugin-types';

import {
  CAPABILITY_ID,
  CAPABILITY_OPERATION,
  CAPABILITY_VERSION,
  SURFACE_INTENT_SCHEMA_ID,
  SURFACE_STATE_SCHEMA_ID,
} from '../shared/constants';
import { parseSurfaceIntent, parseSurfaceState } from '../shared/surface-contract';

export const QUICK_CHAT_PROVIDER_DESCRIPTOR = Object.freeze({
  id: CAPABILITY_ID,
  version: CAPABILITY_VERSION,
  target: 'main',
  cardinality: 'single',
  operations: Object.freeze([
    Object.freeze({
      name: CAPABILITY_OPERATION,
      mutability: 'write',
      // The payload selects open/toggle/focus/close. Conservatively mark the
      // single transport operation non-idempotent because toggle is not.
      idempotency: 'non-idempotent',
      inputSchemaId: SURFACE_INTENT_SCHEMA_ID,
      outputSchemaId: SURFACE_STATE_SCHEMA_ID,
    }),
  ]),
} satisfies HostCapabilityProvided);

export function createQuickChatEndpoint(surface: HostQuickChatSurfaceLike): HostCapabilityEndpoint {
  return Object.freeze({
    async invoke(
      _context: HostInjectedCapabilityContext,
      operation: string,
      payload?: HostWireValue
    ): Promise<HostWireValue> {
      if (operation !== CAPABILITY_OPERATION) {
        throw new TypeError(`Unsupported Quick Chat capability operation: ${operation}`);
      }
      const intent = parseSurfaceIntent(payload);
      const result = await surface.request(intent);
      return parseSurfaceState(result);
    },
  });
}

let unregisterProvider: (() => void) | undefined;

function disposeProvider(): void {
  const unregister = unregisterProvider;
  unregisterProvider = undefined;
  unregister?.();
}

export function activate(host: AgentBackendHostApi): void {
  disposeProvider();
  const capabilities = host.capabilities;
  const surface = host.services.quickChatSurface;
  if (!capabilities || !surface) return;
  unregisterProvider = capabilities.provide(
    QUICK_CHAT_PROVIDER_DESCRIPTOR,
    createQuickChatEndpoint(surface)
  );
}

export function deactivate(): void {
  disposeProvider();
}
