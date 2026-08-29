import type {
  AgentBackendHostApi,
  HostCapabilities,
  HostInjectedCapabilityContext,
  HostQuickChatSurfaceLike,
} from '@elftia/plugin-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPABILITY_OPERATION } from '../shared/constants';
import {
  activate,
  createQuickChatEndpoint,
  deactivate,
  QUICK_CHAT_PROVIDER_DESCRIPTOR,
} from './provider';

const context = Object.freeze({
  consumerPluginId: 'consumer',
  providerPluginId: 'quick-chat',
  projectId: 'caller-controlled',
  sessionId: 'caller-controlled',
  traceId: 'trace',
  signal: {
    aborted: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}) satisfies HostInjectedCapabilityContext;

function hostWith(options: {
  capabilities?: HostCapabilities;
  surface?: HostQuickChatSurfaceLike;
}): AgentBackendHostApi {
  return {
    capabilities: options.capabilities,
    services: options.surface ? { quickChatSurface: options.surface } : {},
  } as AgentBackendHostApi;
}

describe('Quick Chat main provider', () => {
  beforeEach(() => deactivate());

  it('declares one manifest-matching bounded operation', () => {
    expect(QUICK_CHAT_PROVIDER_DESCRIPTOR).toEqual({
      id: 'elftia.quick-chat',
      version: '1.0.0',
      target: 'main',
      cardinality: 'single',
      operations: [
        {
          name: 'surface.request',
          mutability: 'write',
          idempotency: 'non-idempotent',
          inputSchemaId: 'elftia.quick-chat.surface-intent.v1',
          outputSchemaId: 'elftia.quick-chat.surface-state.v1',
        },
      ],
    });
  });

  it.each([{}, { capabilities: {} as HostCapabilities }, { surface: { request: vi.fn() } }])(
    'stays inert without both required Host ports',
    (ports) => {
      expect(() => activate(hostWith(ports))).not.toThrow();
    }
  );

  it('provides once, reloads safely, and deactivates idempotently', () => {
    const firstUnregister = vi.fn();
    const secondUnregister = vi.fn();
    const provide = vi
      .fn()
      .mockReturnValueOnce(firstUnregister)
      .mockReturnValueOnce(secondUnregister);
    const capabilities = { provide } as unknown as HostCapabilities;
    const surface = { request: vi.fn() };

    activate(hostWith({ capabilities, surface }));
    activate(hostWith({ capabilities, surface }));
    expect(provide).toHaveBeenCalledTimes(2);
    expect(firstUnregister).toHaveBeenCalledTimes(1);
    deactivate();
    deactivate();
    expect(secondUnregister).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['open', undefined],
    ['toggle', 'near-active-pet'],
    ['focus', 'near-cursor'],
    ['close', 'primary-bottom-right'],
  ] as const)('validates and delegates %s exactly once', async (operation, placement) => {
    const request = vi
      .fn()
      .mockResolvedValue({ state: operation === 'close' ? 'closed' : 'visible' });
    const endpoint = createQuickChatEndpoint({ request });
    const payload = placement ? { operation, placement } : { operation };
    await expect(endpoint.invoke(context, CAPABILITY_OPERATION, payload)).resolves.toEqual({
      state: operation === 'close' ? 'closed' : 'visible',
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(payload);
  });

  it.each([
    ['open', { operation: 'open', ownerPluginId: 'forged' }],
    ['open', { operation: 'open', windowId: 'forged' }],
    ['open', { operation: 'open', agentId: 'forged' }],
    ['open', { operation: 'open', channelId: 'forged' }],
    ['open', { operation: 'open', transcriptId: 'forged' }],
    ['invalid', { operation: 'invalid' }],
    ['placement', { operation: 'open', placement: 'forged' }],
    ['array', []],
  ])('rejects invalid or identity-bearing input: %s', async (_label, payload) => {
    const request = vi.fn();
    const endpoint = createQuickChatEndpoint({ request });
    await expect(
      endpoint.invoke(context, CAPABILITY_OPERATION, payload as never)
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects unknown capability operations before delegation', async () => {
    const request = vi.fn();
    const endpoint = createQuickChatEndpoint({ request });
    await expect(endpoint.invoke(context, 'open', { operation: 'open' })).rejects.toThrow(
      'Unsupported'
    );
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, {}, { state: 'visible', window: {} }, { state: 'other' }])(
    'rejects invalid Host output %#',
    async (output) => {
      const endpoint = createQuickChatEndpoint({ request: vi.fn().mockResolvedValue(output) });
      await expect(
        endpoint.invoke(context, CAPABILITY_OPERATION, { operation: 'open' })
      ).rejects.toThrow();
    }
  );

  it('ignores caller scope hints and closes only over the owner-bound port', async () => {
    const request = vi.fn().mockResolvedValue({ state: 'visible' });
    const endpoint = createQuickChatEndpoint({ request });
    await endpoint.invoke(
      { ...context, projectId: 'forged-project', sessionId: 'forged-session' },
      CAPABILITY_OPERATION,
      { operation: 'focus' }
    );
    expect(request).toHaveBeenCalledWith({ operation: 'focus' });
  });
});
