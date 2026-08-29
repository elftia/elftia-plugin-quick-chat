import type {
  AgentUiQuickChatHostApi,
  HostLocalChannelClient,
  HostLocalChannelEvent,
  HostLocalChannelMessage,
  HostLocalChannelStatus,
  HostQuickChatSurfaceDefinition,
} from '@elftia/plugin-types';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_ACTIVITY_SERIALIZED_UTF8_BYTES,
  MAX_MESSAGES,
  MAX_STREAM_UTF8_BYTES,
  MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES,
} from '../shared/constants';
import { serializedUtf8Bytes, utf8Bytes } from './conversation-state';
import { activate, deactivate } from './index';
import { QUICK_CHAT_RESOURCES, resolveLocale, translate } from './localization';
import { selectRenderableMessages } from './surface';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function hostMessage(
  index: number,
  content = `message-${index}`,
  role: 'user' | 'assistant' = 'user'
): HostLocalChannelMessage {
  return {
    id: `message-${index}`,
    role,
    content,
    createdAt: '2026-01-01',
    revision: index + 1,
    clientMessageId: role === 'user' ? `client-${index}` : null,
  };
}

function harness(
  options: {
    messages?: HostLocalChannelMessage[];
    localChannels?: boolean;
    status?: HostLocalChannelStatus;
  } = {}
) {
  let eventListener: ((event: HostLocalChannelEvent) => void) | null = null;
  let surface: HostQuickChatSurfaceDefinition | null = null;
  let themeListener: (() => void) | null = null;
  const order: string[] = [];
  const unregisterSurface = vi.fn(() => order.push('surface-unregister'));
  const unregisterLocale = vi.fn(() => order.push('locale-unregister'));
  const unsubscribeTheme = vi.fn(() => order.push('theme-unsubscribe'));
  const registerNamespace = vi.fn(() => unregisterLocale);
  const subscribeTheme = vi.fn((listener: () => void) => {
    themeListener = listener;
    return unsubscribeTheme;
  });
  const messages = options.messages ?? [];
  const client = {
    send: vi.fn<HostLocalChannelClient['send']>(({ text, clientMessageId }) =>
      Promise.resolve({
        accepted: true,
        duplicate: false,
        message: {
          ...hostMessage(messages.length, text),
          clientMessageId,
        },
      })
    ),
    stop: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue({
      endpointId: 'default',
      chatId: 'owner',
      status: options.status ?? 'idle',
      revision: messages.length,
      unreadCount: 0,
      messages,
      hasOlderMessages: false,
    }),
    subscribe: vi.fn((listener: (event: HostLocalChannelEvent) => void) => {
      eventListener = listener;
      return () => {
        order.push('local-unsubscribe');
        eventListener = null;
      };
    }),
    markRead: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(() => {
      order.push('local-detach');
      return Promise.resolve();
    }),
  } satisfies HostLocalChannelClient;

  const Button = ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('button', props, children as React.ReactNode);
  const attach = vi.fn().mockResolvedValue(client);
  const host = {
    version: '1.57.0',
    compat: { state: 'compatible' },
    react: { instance: React, version: React.version },
    ui: { Button } as unknown as AgentUiQuickChatHostApi['ui'],
    i18n: { registerNamespace },
    theme: {
      getSnapshot: vi.fn(() => ({ resolvedMode: 'light', isDarkMode: false })),
      subscribe: subscribeTheme,
    },
    quickChat: {
      registerSurface: vi.fn((definition: HostQuickChatSurfaceDefinition) => {
        surface = definition;
        return unregisterSurface;
      }),
    },
    ...(options.localChannels === false ? {} : { localChannels: { attach } }),
  } as unknown as Partial<AgentUiQuickChatHostApi>;

  return {
    host,
    attach,
    client,
    order,
    getSurface: () => surface,
    emit: (event: HostLocalChannelEvent) => eventListener?.(event),
    emitTheme: () => themeListener?.(),
    unregisterSurface,
    unregisterLocale,
    unsubscribeTheme,
    registerNamespace,
    subscribeTheme,
  };
}

function requireSurface(fixture: ReturnType<typeof harness>): HostQuickChatSurfaceDefinition {
  const surface = fixture.getSurface();
  if (!surface) throw new Error('Quick Chat surface was not registered');
  return surface;
}

function mountSurface(definition: HostQuickChatSurfaceDefinition) {
  const Surface = definition.render as unknown as React.ComponentType;
  return render(React.createElement(Surface));
}

function projectedDepth(element: Element): number {
  const childDepths = Array.from(element.children, projectedDepth);
  return childDepths.length === 0 ? 1 : 1 + Math.max(...childDepths);
}

describe('Quick Chat renderer', () => {
  beforeEach(() => deactivate());
  afterEach(() => {
    cleanup();
    deactivate();
  });

  it('registers one stable surface, locale namespace, and theme subscription', () => {
    const fixture = harness();
    activate(fixture.host);
    expect(fixture.registerNamespace).toHaveBeenCalledWith('quick-chat', QUICK_CHAT_RESOURCES);
    expect(fixture.subscribeTheme).toHaveBeenCalledOnce();
    expect(fixture.getSurface()?.id).toBe('default');
  });

  it('renders loading then the empty accessible transcript and marks read', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    expect(screen.getByTestId('quick-chat-state')).toHaveTextContent('Loading');
    await screen.findByTestId('quick-chat-empty');
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByLabelText('Message Elfi')).toBeEnabled();
    expect(fixture.client.markRead).toHaveBeenCalledOnce();
  });

  it('renders transcript text inertly and shows bounded history notice', async () => {
    const malicious = '<script>alert(1)</script> **markdown** onclick="x"';
    const fixture = harness({ messages: [hostMessage(0, malicious, 'assistant')] });
    activate(fixture.host);
    const view = mountSurface(requireSurface(fixture));
    expect(await screen.findByText(malicious)).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.innerHTML).not.toContain('<script>alert');
  });

  it('submits once, clears the draft, and reconciles the Host message', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    const input = await screen.findByLabelText('Message Elfi');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(fixture.client.send).toHaveBeenCalledOnce());
    const firstCall = fixture.client.send.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({ text: 'hello' });
    expect(firstCall?.clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('owns rapid submission synchronously until the first completion settles', async () => {
    const accepted = deferred<Awaited<ReturnType<HostLocalChannelClient['send']>>>();
    const fixture = harness();
    fixture.client.send.mockImplementationOnce(() => accepted.promise);
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    const input = await screen.findByLabelText('Message Elfi');
    const send = screen.getByLabelText('Send message');
    fireEvent.change(input, { target: { value: 'first' } });

    await act(async () => {
      send.click();
      send.click();
      await Promise.resolve();
    });
    expect(fixture.client.send).toHaveBeenCalledOnce();
    expect(input).toBeDisabled();
    expect(send).toBeDisabled();
    const request = fixture.client.send.mock.calls[0]?.[0];
    if (!request) throw new Error('expected the first logical send');

    accepted.resolve({
      accepted: true,
      duplicate: false,
      message: {
        ...hostMessage(0, 'first'),
        clientMessageId: request.clientMessageId,
      },
    });
    await act(async () => {
      await accepted.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(send).toBeEnabled());
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: 'second' } });
    await act(async () => await Promise.resolve());
    expect(input).toHaveValue('second');
    expect(fixture.client.send).toHaveBeenCalledOnce();
  });

  it('shows Stop only while processing and does not detach when stopping', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    expect(screen.queryByLabelText('Stop response')).toBeNull();
    fixture.emit({ type: 'status', revision: 1, status: 'processing' });
    fireEvent.click(await screen.findByLabelText('Stop response'));
    await waitFor(() => expect(fixture.client.stop).toHaveBeenCalledOnce());
    expect(fixture.client.detach).not.toHaveBeenCalled();
  });

  it('contains a rejected Stop as localized retryable UI state', async () => {
    const fixture = harness();
    fixture.client.stop.mockRejectedValueOnce(new Error('private transport detail'.repeat(1000)));
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    fixture.emit({ type: 'status', revision: 1, status: 'processing' });
    fireEvent.click(await screen.findByLabelText('Stop response'));
    expect(await screen.findByText('The conversation could not be refreshed.')).toBeInTheDocument();
    expect(screen.queryByText(/private transport detail/)).toBeNull();
    expect(screen.getByLabelText('Retry')).toBeInTheDocument();
  });

  it('contains a rejected initial attach and recovers through localized Retry', async () => {
    const fixture = harness();
    fixture.attach.mockRejectedValueOnce(new Error('private attach detail'.repeat(1000)));
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    expect(await screen.findByText('The conversation could not be refreshed.')).toBeInTheDocument();
    expect(screen.queryByText(/private attach detail/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Retry'));
    await screen.findByTestId('quick-chat-empty');
    expect(fixture.attach).toHaveBeenCalledTimes(2);
  });

  it('renders a revoked state with a bounded reattach action', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    fixture.emit({ type: 'revoked', code: 'NOT_DECLARED' });
    expect(await screen.findByText('Quick Chat is unavailable.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Elfi')).toBeDisabled();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
    expect(screen.getByLabelText('Retry')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retry'));
    await waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
  });

  it('renders a suspended snapshot with a bounded reattach action', async () => {
    const fixture = harness({ status: 'suspended' });
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    expect(await screen.findByText('Quick Chat is temporarily suspended.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Elfi')).toBeDisabled();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Retry'));
    await waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
  });

  it('renders a suspended status event with a bounded reattach action', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    fixture.emit({ type: 'status', revision: 1, status: 'suspended' });
    expect(await screen.findByText('Quick Chat is temporarily suspended.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retry'));
    await waitFor(() => expect(fixture.attach).toHaveBeenCalledTimes(2));
  });

  it('renders bounded reasoning activity even when no text delta exists', async () => {
    const fixture = harness();
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    fixture.emit({
      type: 'stream',
      revision: 1,
      stream: { type: 'reasoning', text: '\u0000'.repeat(1024 * 1024) },
    });
    const stream = await screen.findByTestId('quick-chat-stream');
    expect(stream).toBeInTheDocument();
    expect(stream.textContent).not.toBe('');
    expect(utf8Bytes(JSON.stringify(stream.textContent))).toBeLessThanOrEqual(
      MAX_ACTIVITY_SERIALIZED_UTF8_BYTES
    );
  });

  it('degrades to an unavailable semantic surface without Local Channels', () => {
    const fixture = harness({ localChannels: false });
    activate(fixture.host);
    mountSurface(requireSurface(fixture));
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  });

  it('disposes surface, locale, theme, subscription, then detaches without Stop', async () => {
    const fixture = harness();
    activate(fixture.host);
    const view = mountSurface(requireSurface(fixture));
    await screen.findByTestId('quick-chat-empty');
    fixture.emitTheme();
    view.unmount();
    await waitFor(() => expect(fixture.client.detach).toHaveBeenCalledOnce());
    expect(fixture.order.indexOf('local-unsubscribe')).toBeLessThan(
      fixture.order.indexOf('local-detach')
    );
    deactivate();
    deactivate();
    expect(fixture.unregisterSurface).toHaveBeenCalledOnce();
    expect(fixture.unregisterLocale).toHaveBeenCalledOnce();
    expect(fixture.unsubscribeTheme).toHaveBeenCalledOnce();
    expect(fixture.client.stop).not.toHaveBeenCalled();
  });
});

describe('localization and projection bounds', () => {
  it.each([
    ['en-US', 'en', 'Quick Chat'],
    ['zh-CN', 'zh-CN', '快捷对话'],
    ['ja-JP', 'ja', 'クイックチャット'],
    ['fr-FR', 'en', 'Quick Chat'],
  ] as const)('resolves %s with English fallback', (input, locale, title) => {
    expect(resolveLocale(input)).toBe(locale);
    expect(translate(input, 'title')).toBe(title);
  });

  it('bounds maximum transcript projection to 200 messages and 224 KiB serialized text', () => {
    const content = '界'.repeat(2_000);
    const messages = Array.from({ length: MAX_MESSAGES + 20 }, (_, index) =>
      hostMessage(index, content, index % 2 ? 'assistant' : 'user')
    );
    const result = selectRenderableMessages(messages);
    expect(result.messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(result.omitted).toBe(true);
    expect(result.messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(
      serializedUtf8Bytes(result.messages.map((message) => message.content))
    ).toBeLessThanOrEqual(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
  });

  it('keeps the stream ceiling below the remote frame budget', () => {
    expect(MAX_STREAM_UTF8_BYTES).toBe(64 * 1024);
    expect(MAX_STREAM_UTF8_BYTES + MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES).toBeLessThan(512 * 1024);
  });

  it('keeps the maximum semantic projection inside opaque-frame quotas', async () => {
    const messages = Array.from({ length: MAX_MESSAGES }, (_, index) =>
      hostMessage(index, `message-${index}-${'x'.repeat(1_700)}`, index % 2 ? 'assistant' : 'user')
    );
    const fixture = harness({ messages });
    activate(fixture.host);
    const view = mountSurface(requireSurface(fixture));
    await waitFor(() =>
      expect(
        view.container.querySelectorAll('[data-testid^="quick-chat-message-"]').length
      ).toBeGreaterThan(0)
    );
    expect(
      view.container.querySelectorAll('[data-testid^="quick-chat-message-"]').length
    ).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(screen.getByTestId('quick-chat-budget-notice')).toBeInTheDocument();

    fixture.emit({
      type: 'stream',
      revision: MAX_MESSAGES + 1,
      stream: { type: 'text', delta: '界'.repeat(MAX_STREAM_UTF8_BYTES) },
    });
    for (let index = 0; index < 20; index += 1) {
      fixture.emit({
        type: 'stream',
        revision: MAX_MESSAGES + index + 2,
        stream: { type: 'reasoning', text: `activity-${index}` },
      });
    }
    const stream = await screen.findByTestId('quick-chat-stream');
    await waitFor(() => expect(stream.querySelectorAll('p')).toHaveLength(17));

    const elements = Array.from(view.container.querySelectorAll('*'));
    expect(elements.length).toBeLessThanOrEqual(4_096);
    expect(projectedDepth(view.container)).toBeLessThanOrEqual(64);
    expect(utf8Bytes(view.container.innerHTML)).toBeLessThanOrEqual(512 * 1024);
    for (const element of elements) {
      for (const attribute of Array.from(element.attributes)) {
        expect(['class', 'style', 'href', 'src', 'ref'].includes(attribute.name)).toBe(false);
        expect(attribute.name.startsWith('on')).toBe(false);
      }
    }
  });
});
