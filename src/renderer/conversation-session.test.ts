import type {
  HostLocalChannelClient,
  HostLocalChannelEvent,
  HostLocalChannelSnapshot,
  HostLocalChannels,
} from '@elftia/plugin-types';
import { describe, expect, it, vi } from 'vitest';

import { ConversationSession } from './conversation-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function snapshot(revision = 0): HostLocalChannelSnapshot {
  return {
    endpointId: 'default',
    chatId: 'owner',
    status: 'idle',
    revision,
    unreadCount: 0,
    messages: [],
    hasOlderMessages: false,
  };
}

function message(id: string, revision: number) {
  return {
    id,
    role: 'assistant' as const,
    content: id,
    createdAt: '2026-01-01',
    revision,
    clientMessageId: null,
  };
}

function client(getSnapshot = vi.fn().mockResolvedValue(snapshot())) {
  let listener: ((event: HostLocalChannelEvent) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    listener = null;
  });
  const value = {
    send: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    getSnapshot,
    subscribe: vi.fn((next: (event: HostLocalChannelEvent) => void) => {
      listener = next;
      return unsubscribe;
    }),
    markRead: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
  } satisfies HostLocalChannelClient;
  return { value, unsubscribe, emit: (event: HostLocalChannelEvent) => listener?.(event) };
}

describe('ConversationSession lifecycle', () => {
  it('subscribes before snapshot, buffers events, marks read, and preserves order', async () => {
    const initial = deferred<HostLocalChannelSnapshot>();
    const fixture = client(vi.fn(() => initial.promise));
    const channels = { attach: vi.fn().mockResolvedValue(fixture.value) };
    const states: number[] = [];
    const session = new ConversationSession(channels, (state) => states.push(state.revision));
    const start = session.start();
    await vi.waitFor(() => expect(fixture.value.subscribe).toHaveBeenCalledOnce());
    fixture.emit({ type: 'status', revision: 1, status: 'processing' });
    initial.resolve(snapshot(0));
    await start;
    expect(session.getState()).toMatchObject({ revision: 1, status: 'processing' });
    expect(fixture.value.markRead).toHaveBeenCalledOnce();
    expect(states).toEqual([0, 1]);
  });

  it('queues a second refresh when a higher gap arrives during an in-flight resnapshot', async () => {
    const firstReplacement = deferred<HostLocalChannelSnapshot>();
    const secondReplacement = deferred<HostLocalChannelSnapshot>();
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1))
      .mockImplementationOnce(() => firstReplacement.promise)
      .mockImplementationOnce(() => secondReplacement.promise);
    const fixture = client(getSnapshot);
    const session = new ConversationSession(
      { attach: vi.fn().mockResolvedValue(fixture.value) },
      vi.fn()
    );
    await session.start();
    fixture.emit({ type: 'status', revision: 3, status: 'processing' });
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    fixture.emit({ type: 'unread', revision: 4, unreadCount: 2 });
    firstReplacement.resolve(snapshot(3));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    expect(session.getState()).toMatchObject({
      revision: 3,
      needsSnapshot: true,
      requiredSnapshotRevision: 4,
    });
    secondReplacement.resolve({ ...snapshot(4), unreadCount: 2 });
    await vi.waitFor(() =>
      expect(session.getState()).toMatchObject({
        revision: 4,
        unreadCount: 2,
        needsSnapshot: false,
        requiredSnapshotRevision: null,
      })
    );
    expect(getSnapshot).toHaveBeenCalledTimes(3);
  });

  it('unregisters before detach and never stops during cleanup', async () => {
    const order: string[] = [];
    let listener: ((event: HostLocalChannelEvent) => void) | null = null;
    const value = {
      send: vi.fn(),
      stop: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(snapshot()),
      subscribe: vi.fn((next: (event: HostLocalChannelEvent) => void) => {
        listener = next;
        return () => {
          order.push('unsubscribe');
          listener = null;
        };
      }),
      markRead: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn(() => {
        order.push('detach');
        return Promise.resolve();
      }),
    } satisfies HostLocalChannelClient;
    const session = new ConversationSession({ attach: vi.fn().mockResolvedValue(value) }, vi.fn());
    await session.start();
    await session.dispose();
    await session.dispose();
    expect(listener).toBeNull();
    expect(order).toEqual(['unsubscribe', 'detach']);
    expect(value.stop).not.toHaveBeenCalled();
  });

  it('calls stop only while processing and stays attached', async () => {
    const fixture = client();
    const session = new ConversationSession(
      { attach: vi.fn().mockResolvedValue(fixture.value) },
      vi.fn()
    );
    await session.start();
    await session.stop();
    expect(fixture.value.stop).not.toHaveBeenCalled();
    fixture.emit({ type: 'status', revision: 1, status: 'processing' });
    await session.stop();
    expect(fixture.value.stop).toHaveBeenCalledOnce();
    expect(fixture.value.detach).not.toHaveBeenCalled();
  });

  it('reattaches after revocation and replays the final Host snapshot', async () => {
    const first = client();
    const second = client(vi.fn().mockResolvedValue(snapshot(8)));
    const attach = vi
      .fn<HostLocalChannels['attach']>()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const session = new ConversationSession({ attach }, vi.fn());
    await session.start();
    first.emit({ type: 'revoked', code: 'ENDPOINT_UNAVAILABLE' });
    expect(session.getState().phase).toBe('revoked');
    await session.reattach();
    expect(first.value.detach).toHaveBeenCalledOnce();
    expect(session.getState()).toMatchObject({ phase: 'ready', revision: 8 });
  });

  it('fences a stale refresh snapshot after reattach replaces the client', async () => {
    const staleSnapshot = deferred<HostLocalChannelSnapshot>();
    const first = client(
      vi
        .fn()
        .mockResolvedValueOnce(snapshot(1))
        .mockImplementationOnce(() => staleSnapshot.promise)
    );
    const second = client(
      vi.fn().mockResolvedValue({
        ...snapshot(10),
        messages: [message('new-generation', 10)],
      })
    );
    const attach = vi
      .fn<HostLocalChannels['attach']>()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const session = new ConversationSession({ attach }, vi.fn());
    await session.start();
    first.emit({ type: 'status', revision: 3, status: 'processing' });
    await vi.waitFor(() => expect(first.value.getSnapshot).toHaveBeenCalledTimes(2));
    const oldRefresh = session.refresh();
    first.emit({ type: 'revoked', code: 'ENDPOINT_UNAVAILABLE' });
    await session.reattach();
    expect(session.getState().messages.map((item) => item.id)).toEqual(['new-generation']);

    staleSnapshot.resolve({ ...snapshot(3), messages: [message('stale-old-generation', 3)] });
    await oldRefresh;
    expect(session.getState()).toMatchObject({ phase: 'ready', revision: 10 });
    expect(session.getState().messages.map((item) => item.id)).toEqual(['new-generation']);
    expect(first.value.markRead).toHaveBeenCalledOnce();
    expect(first.value.detach).toHaveBeenCalledOnce();
  });

  it('fences a stale markRead rejection after the replacement snapshot wins', async () => {
    const staleMarkRead = deferred<undefined>();
    const first = client(
      vi.fn().mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(3))
    );
    first.value.markRead
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => staleMarkRead.promise);
    const second = client(vi.fn().mockResolvedValue(snapshot(10)));
    const attach = vi
      .fn<HostLocalChannels['attach']>()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const session = new ConversationSession({ attach }, vi.fn());
    await session.start();
    first.emit({ type: 'status', revision: 3, status: 'processing' });
    await vi.waitFor(() => expect(first.value.markRead).toHaveBeenCalledTimes(2));
    const oldRefresh = session.refresh();
    first.emit({ type: 'revoked', code: 'ENDPOINT_UNAVAILABLE' });
    await session.reattach();
    staleMarkRead.reject(new Error('old mark-read failed'));
    await oldRefresh;
    expect(session.getState()).toMatchObject({ phase: 'ready', revision: 10, error: null });
  });

  it('coalesces rapid reattach calls and never leaks an intermediate client', async () => {
    const detached = deferred<undefined>();
    const first = client();
    first.value.detach.mockImplementationOnce(() => detached.promise);
    const second = client(vi.fn().mockResolvedValue(snapshot(10)));
    const attach = vi
      .fn<HostLocalChannels['attach']>()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const session = new ConversationSession({ attach }, vi.fn());
    await session.start();

    const firstRetry = session.reattach();
    const secondRetry = session.reattach();
    expect(secondRetry).toBe(firstRetry);
    await vi.waitFor(() => expect(first.value.detach).toHaveBeenCalledOnce());
    expect(attach).toHaveBeenCalledOnce();
    detached.resolve(undefined);
    await Promise.all([firstRetry, secondRetry]);

    expect(attach).toHaveBeenCalledTimes(2);
    expect(first.value.detach).toHaveBeenCalledOnce();
    expect(second.value.detach).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ revision: 10, phase: 'ready' });
  });

  it('coalesces start and deterministically detaches an attach superseded by dispose', async () => {
    const attached = deferred<HostLocalChannelClient>();
    const fixture = client();
    const attach = vi.fn<HostLocalChannels['attach']>(() => attached.promise);
    const session = new ConversationSession({ attach }, vi.fn());
    const firstStart = session.start();
    const secondStart = session.start();
    expect(secondStart).toBe(firstStart);
    expect(attach).toHaveBeenCalledOnce();
    await session.dispose();
    attached.resolve(fixture.value);
    await Promise.all([firstStart, secondStart]);
    expect(fixture.value.detach).toHaveBeenCalledOnce();
    expect(fixture.value.subscribe).not.toHaveBeenCalled();
    expect(session.getState().error).toBeNull();
  });

  it('contains attach and initial markRead rejection as bounded retryable state', async () => {
    const failedAttach = new ConversationSession(
      { attach: vi.fn().mockRejectedValue(new Error('unbounded secret attach error')) },
      vi.fn()
    );
    await expect(failedAttach.start()).resolves.toBeUndefined();
    expect(failedAttach.getState().error).toEqual({
      code: 'ATTACH_FAILED',
      message: 'Quick Chat attachment failed.',
      retryable: true,
    });

    const fixture = client();
    fixture.value.markRead.mockRejectedValueOnce(new Error('unbounded mark-read error'));
    const failedMarkRead = new ConversationSession(
      { attach: vi.fn().mockResolvedValue(fixture.value) },
      vi.fn()
    );
    await expect(failedMarkRead.start()).resolves.toBeUndefined();
    expect(failedMarkRead.getState().error).toEqual({
      code: 'MARK_READ_FAILED',
      message: 'The conversation could not be marked as read.',
      retryable: true,
    });
    expect(fixture.value.detach).not.toHaveBeenCalled();
  });

  it('continues reattach after detach rejects and contains stop rejection', async () => {
    const first = client();
    first.value.detach.mockRejectedValueOnce(new Error('detach failed'));
    const second = client(vi.fn().mockResolvedValue(snapshot(8)));
    second.value.stop.mockRejectedValueOnce(new Error('stop failed'));
    const attach = vi
      .fn<HostLocalChannels['attach']>()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const session = new ConversationSession({ attach }, vi.fn());
    await session.start();
    await expect(session.reattach()).resolves.toBeUndefined();
    expect(attach).toHaveBeenCalledTimes(2);
    second.emit({ type: 'status', revision: 9, status: 'processing' });
    await expect(session.stop()).resolves.toBeUndefined();
    expect(session.getState().error).toEqual({
      code: 'STOP_FAILED',
      message: 'The response could not be stopped.',
      retryable: true,
    });
  });

  it('finishes detach after unsubscribe throws and contains dispose rejection', async () => {
    const fixture = client();
    const throwingUnsubscribe = vi.fn(() => {
      throw new Error('unsubscribe failed');
    });
    fixture.value.subscribe.mockImplementationOnce(() => throwingUnsubscribe);
    fixture.value.detach.mockRejectedValueOnce(new Error('detach failed'));
    const session = new ConversationSession(
      { attach: vi.fn().mockResolvedValue(fixture.value) },
      vi.fn()
    );
    await session.start();
    await expect(session.dispose()).resolves.toBeUndefined();
    expect(throwingUnsubscribe).toHaveBeenCalledOnce();
    expect(fixture.value.detach).toHaveBeenCalledOnce();
    expect(fixture.value.stop).not.toHaveBeenCalled();
  });
});
