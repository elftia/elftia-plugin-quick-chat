import type {
  HostQuickChatOperation,
  HostQuickChatPlacementIntent,
  HostQuickChatSurfaceRequest,
  HostQuickChatSurfaceResult,
  HostWireValue,
} from '@elftia/plugin-types';

export const SURFACE_OPERATIONS = [
  'open',
  'toggle',
  'focus',
  'close',
] as const satisfies readonly HostQuickChatOperation[];
export const PLACEMENT_INTENTS = [
  'near-active-pet',
  'near-cursor',
  'primary-bottom-right',
] as const satisfies readonly HostQuickChatPlacementIntent[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseSurfaceIntent(value: HostWireValue | undefined): HostQuickChatSurfaceRequest {
  if (!isRecord(value) || !exactKeys(value, ['operation', 'placement'])) {
    throw new TypeError('Quick Chat surface intent must contain only operation and placement');
  }
  if (!(SURFACE_OPERATIONS as readonly unknown[]).includes(value.operation)) {
    throw new TypeError('Quick Chat surface operation is invalid');
  }
  if (
    value.placement !== undefined &&
    !(PLACEMENT_INTENTS as readonly unknown[]).includes(value.placement)
  ) {
    throw new TypeError('Quick Chat placement intent is invalid');
  }
  return value.placement === undefined
    ? { operation: value.operation as HostQuickChatOperation }
    : {
        operation: value.operation as HostQuickChatOperation,
        placement: value.placement as HostQuickChatPlacementIntent,
      };
}

export function parseSurfaceState(value: unknown): HostQuickChatSurfaceResult & HostWireValue {
  if (!isRecord(value) || !exactKeys(value, ['state'])) {
    throw new TypeError('Quick Chat surface state must contain only state');
  }
  if (value.state !== 'visible' && value.state !== 'closed') {
    throw new TypeError('Quick Chat surface state is invalid');
  }
  return { state: value.state };
}
