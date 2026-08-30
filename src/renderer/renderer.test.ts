import type {
  HostLocalChannelEvent,
  HostLocalChannelMessage,
  HostLocalChannelStatus,
  HostThemeSnapshot,
  QuickChatWindowHost,
  QuickChatWindowLocalChannelClient,
} from '@elftia/plugin-types';
import { readFile } from 'node:fs/promises';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_ACTIVITY_SERIALIZED_UTF8_BYTES,
  MAX_MESSAGES,
  MAX_STREAM_UTF8_BYTES,
  MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES,
} from '../shared/constants';
import { serializedUtf8Bytes, utf8Bytes } from './conversation-state';
import quickChatWindowModule from './index';
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
    readonly messages?: HostLocalChannelMessage[];
    readonly status?: HostLocalChannelStatus;
  } = {}
) {
  let eventListener: ((event: HostLocalChannelEvent) => void) | null = null;
  let themeListener: ((snapshot: HostThemeSnapshot) => void) | null = null;
  let themeSnapshot: HostThemeSnapshot = { resolvedMode: 'light', isDarkMode: false };
  const order: string[] = [];
  const unregisterLocale = vi.fn(() => order.push('locale-unregister'));
  const unsubscribeTheme = vi.fn(() => order.push('theme-unsubscribe'));
  const registerNamespace = vi.fn(() => unregisterLocale);
  const subscribeTheme = vi.fn((listener: (snapshot: HostThemeSnapshot) => void) => {
    themeListener = listener;
    return unsubscribeTheme;
  });
  const messages = options.messages ?? [];
  const client = {
    send: vi.fn<QuickChatWindowLocalChannelClient['send']>(({ text, clientMessageId }) =>
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
  } satisfies QuickChatWindowLocalChannelClient;
  const attach = vi.fn().mockResolvedValue(client);
  const close = vi.fn().mockResolvedValue(undefined);
  const host = {
    version: '1.58.0',
    compat: { builtAgainst: '1.58.0', requiredMajor: 1, requiredMinor: 58 },
    i18n: { registerNamespace },
    theme: {
      getSnapshot: vi.fn(() => themeSnapshot),
      subscribe: subscribeTheme,
    },
    localChannel: { attach },
    close: { request: close },
  } satisfies QuickChatWindowHost;

  return {
    host,
    attach,
    client,
    close,
    order,
    registerNamespace,
    unregisterLocale,
    subscribeTheme,
    unsubscribeTheme,
    emit: (event: HostLocalChannelEvent) => eventListener?.(event),
    emitTheme: (snapshot: HostThemeSnapshot) => {
      themeSnapshot = snapshot;
      themeListener?.(snapshot);
    },
  };
}

const activeDisposers: (() => void)[] = [];

function activate(fixture: ReturnType<typeof harness>) {
  const root = document.createElement('div');
  root.dataset.testid = 'quick-chat-host-root';
  document.body.append(root);
  let disposer: (() => void) | undefined;
  act(() => {
    const result = quickChatWindowModule.activate(fixture.host, { root });
    if (typeof result !== 'function') throw new Error('expected a synchronous disposer');
    disposer = result;
  });
  if (!disposer) throw new Error('Quick Chat activation did not return a disposer');
  activeDisposers.push(disposer);
  return { root, dispose: disposer };
}

afterEach(() => {
  act(() => {
    for (const dispose of activeDisposers.splice(0).reverse()) dispose();
  });
  cleanup();
  document.body.replaceChildren();
});

describe('Quick Chat dedicated window module', () => {
  it('default-exports exactly the sole activate lifecycle', () => {
    expect(Object.keys(quickChatWindowModule)).toEqual(['activate']);
    expect(typeof quickChatWindowModule.activate).toBe('function');
  });

  it('contains no Host implementation, raw native bridge, or Pet authority', async () => {
    const source = (
      await Promise.all(
        [
          'index.ts',
          'surface.ts',
          'conversation-session.ts',
          'conversation-state.ts',
          'submission.ts',
          'localization.ts',
          'styles.ts',
        ].map((file) => readFile(new URL(file, import.meta.url), 'utf8'))
      )
    ).join('\n');
    for (const forbidden of [
      /@main\//,
      /@elftia\/shared/,
      /from\s+['"](?:electron|node:)/,
      /ipcRenderer/,
      /window\.native/,
      /\bpreload\b/i,
      /AgentUiQuickChatHostApi/,
      /AgentUiHostApi/,
      /HostLocalChannels/,
      /petRuntime/,
      /petNative/,
      /capabilityToken/,
      /registerSurface/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('fails closed for a missing scoped Host or invalid root', () => {
    const root = document.createElement('div');
    expect(() => quickChatWindowModule.activate({} as QuickChatWindowHost, { root })).toThrow(
      /Host/
    );
    expect(() =>
      quickChatWindowModule.activate(harness().host, { root: null as unknown as HTMLElement })
    ).toThrow(/HTMLElement/);
    expect(root).toBeEmptyDOMElement();
  });

  it('owns the complete UI, styles, fixed attach, focus, and theme projection', async () => {
    const fixture = harness();
    const { root } = activate(fixture);
    expect(fixture.registerNamespace).toHaveBeenCalledWith('quick-chat', QUICK_CHAT_RESOURCES);
    expect(fixture.subscribeTheme).toHaveBeenCalledOnce();
    await screen.findByTestId('quick-chat-empty');
    expect(fixture.attach).toHaveBeenCalledWith();
    expect(fixture.client.subscribe).toHaveBeenCalledBefore(fixture.client.getSnapshot);
    expect(fixture.client.markRead).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Quick Chat' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(screen.getByLabelText('Message Elfi')).toHaveFocus());
    const css = screen.getByTestId('quick-chat-styles').textContent;
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
    expect(css).toContain(':focus-visible');
    expect(root.querySelector('[data-theme="light"]')).not.toBeNull();

    act(() => fixture.emitTheme({ resolvedMode: 'dark', isDarkMode: true }));
    expect(root.querySelector('[data-theme="dark"]')).not.toBeNull();
  });

  it('routes close only through the bounded Host intent', async () => {
    const fixture = harness({ status: 'processing' });
    activate(fixture);
    fireEvent.click(await screen.findByLabelText('Close Quick Chat'));
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.client.stop).not.toHaveBeenCalled();
    expect(fixture.client.detach).not.toHaveBeenCalled();
  });

  it('renders hostile transcript content as inert bounded text', async () => {
    const malicious = '<script>alert(1)</script><img src=x onerror=alert(2)> **markdown**';
    const fixture = harness({ messages: [hostMessage(0, malicious, 'assistant')] });
    const { root } = activate(fixture);
    expect(await screen.findByText(malicious)).toBeInTheDocument();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.innerHTML).not.toContain('<script>alert');
  });

  it('submits once, preserves a newer draft, and reconciles the Host message', async () => {
    const accepted = deferred<Awaited<ReturnType<QuickChatWindowLocalChannelClient['send']>>>();
    const fixture = harness();
    fixture.client.send.mockImplementationOnce(() => accepted.promise);
    activate(fixture);
    const input = await screen.findByLabelText('Message Elfi');
    const send = screen.getByLabelText('Send message');
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(fixture.client.send).toHaveBeenCalledOnce();
    const request = fixture.client.send.mock.calls[0]?.[0];
    if (!request) throw new Error('expected one logical send');
    fireEvent.change(input, { target: { value: 'second' } });
    accepted.resolve({
      accepted: true,
      duplicate: false,
      message: { ...hostMessage(0, 'first'), clientMessageId: request.clientMessageId },
    });
    await accepted.promise;
    await waitFor(() => expect(input).toHaveValue('second'));
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('shows Stop only while processing and keeps the attachment alive', async () => {
    const fixture = harness();
    activate(fixture);
    await screen.findByTestId('quick-chat-empty');
    expect(screen.queryByLabelText('Stop response')).toBeNull();
    act(() => fixture.emit({ type: 'status', revision: 1, status: 'processing' }));
    fireEvent.click(await screen.findByLabelText('Stop response'));
    await waitFor(() => expect(fixture.client.stop).toHaveBeenCalledOnce());
    expect(fixture.client.detach).not.toHaveBeenCalled();
  });

  it('owns transcript-tail scrolling as messages and stream state advance', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const fixture = harness();
    activate(fixture);
    await screen.findByTestId('quick-chat-empty');
    scrollIntoView.mockClear();
    act(() => {
      fixture.emit({
        type: 'message',
        revision: 1,
        message: hostMessage(0, 'replayed response', 'assistant'),
      });
      fixture.emit({
        type: 'stream',
        revision: 2,
        stream: { type: 'text', delta: 'stream delta' },
      });
    });
    expect(await screen.findByText('replayed response')).toBeInTheDocument();
    expect(await screen.findByText('stream delta')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('disposes subscriptions and attachment once without stop or DOM revival', async () => {
    const fixture = harness();
    const { root, dispose } = activate(fixture);
    await screen.findByTestId('quick-chat-empty');
    act(() => {
      dispose();
      dispose();
      globalThis.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => expect(fixture.client.detach).toHaveBeenCalledOnce());
    expect(fixture.order.indexOf('local-unsubscribe')).toBeLessThan(
      fixture.order.indexOf('local-detach')
    );
    expect(fixture.unregisterLocale).toHaveBeenCalledOnce();
    expect(fixture.unsubscribeTheme).toHaveBeenCalledOnce();
    expect(fixture.client.stop).not.toHaveBeenCalled();
    expect(root).toBeEmptyDOMElement();
    act(() => fixture.emitTheme({ resolvedMode: 'dark', isDarkMode: true }));
    expect(root).toBeEmptyDOMElement();
  });

  it('detaches a deferred attachment acquired after disposal without subscribing', async () => {
    const fixture = harness();
    const attached = deferred<QuickChatWindowLocalChannelClient>();
    fixture.attach.mockImplementationOnce(() => attached.promise);
    const { root, dispose } = activate(fixture);
    act(() => dispose());
    attached.resolve(fixture.client);
    await attached.promise;
    await waitFor(() => expect(fixture.client.detach).toHaveBeenCalledOnce());
    expect(fixture.client.subscribe).not.toHaveBeenCalled();
    expect(fixture.client.stop).not.toHaveBeenCalled();
    expect(root).toBeEmptyDOMElement();
  });

  it('renders bounded live reasoning activity', async () => {
    const fixture = harness();
    activate(fixture);
    await screen.findByTestId('quick-chat-empty');
    act(() =>
      fixture.emit({
        type: 'stream',
        revision: 1,
        stream: { type: 'reasoning', text: '\u0000'.repeat(1024 * 1024) },
      })
    );
    const stream = await screen.findByTestId('quick-chat-stream');
    expect(utf8Bytes(JSON.stringify(stream.textContent))).toBeLessThanOrEqual(
      MAX_ACTIVITY_SERIALIZED_UTF8_BYTES
    );
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

  it('bounds transcript projection to 200 messages and 224 KiB serialized text', () => {
    const content = '界'.repeat(2_000);
    const messages = Array.from({ length: MAX_MESSAGES + 20 }, (_, index) =>
      hostMessage(index, content, index % 2 ? 'assistant' : 'user')
    );
    const result = selectRenderableMessages(messages);
    expect(result.messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(result.omitted).toBe(true);
    expect(
      serializedUtf8Bytes(result.messages.map((message) => message.content))
    ).toBeLessThanOrEqual(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
    expect(MAX_STREAM_UTF8_BYTES).toBe(64 * 1024);
  });

  it('reserves array delimiters at the exact single-string boundary', () => {
    const content = 'x'.repeat(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES - 2);
    const result = selectRenderableMessages([hostMessage(0, content)]);

    expect(serializedUtf8Bytes(content)).toBe(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
    expect(serializedUtf8Bytes([content])).toBe(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES + 2);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content.endsWith('…')).toBe(true);
    expect(result.omitted).toBe(true);
    expect(
      serializedUtf8Bytes(result.messages.map((message) => message.content))
    ).toBeLessThanOrEqual(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
  });

  it('keeps an escaping-heavy oversized message within the array-wide ceiling', () => {
    const content = '\u0000"\\'.repeat(Math.ceil(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES / 3));
    const result = selectRenderableMessages([hostMessage(0, content)]);

    expect(serializedUtf8Bytes([content])).toBeGreaterThan(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content.endsWith('…')).toBe(true);
    expect(result.omitted).toBe(true);
    expect(
      serializedUtf8Bytes(result.messages.map((message) => message.content))
    ).toBeLessThanOrEqual(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
  });

  it('selects newest messages first and returns them in chronological order', () => {
    const content = 'x'.repeat(80 * 1024);
    const result = selectRenderableMessages([
      hostMessage(0, content),
      hostMessage(1, content),
      hostMessage(2, content),
    ]);

    expect(result.messages.map((message) => message.id)).toEqual(['message-1', 'message-2']);
    expect(result.omitted).toBe(true);
    expect(
      serializedUtf8Bytes(result.messages.map((message) => message.content))
    ).toBeLessThanOrEqual(MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES);
  });
});
