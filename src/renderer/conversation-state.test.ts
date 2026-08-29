import type {
  HostLocalChannelEvent,
  HostLocalChannelMessage,
  HostLocalChannelSnapshot,
} from '@elftia/plugin-types';
import { describe, expect, it } from 'vitest';

import {
  MAX_ACTIVITY_ITEM_UTF8_BYTES,
  MAX_ACTIVITY_ITEMS,
  MAX_ACTIVITY_SERIALIZED_UTF8_BYTES,
  MAX_STREAM_UTF8_BYTES,
} from '../shared/constants';
import { conversationReducer, INITIAL_CONVERSATION_STATE, utf8Bytes } from './conversation-state';

function message(
  id: string,
  revision: number,
  role: 'user' | 'assistant' = 'user',
  clientMessageId: string | null = null
): HostLocalChannelMessage {
  return { id, revision, role, clientMessageId, content: `<b>${id}</b>`, createdAt: '2026-01-01' };
}

function snapshot(overrides: Partial<HostLocalChannelSnapshot> = {}): HostLocalChannelSnapshot {
  return {
    endpointId: 'default',
    chatId: 'owner',
    status: 'idle',
    revision: 0,
    unreadCount: 0,
    messages: [],
    hasOlderMessages: false,
    ...overrides,
  };
}

describe('conversationReducer', () => {
  it('atomically replaces snapshot state and clears transient/error state', () => {
    const dirty = {
      ...INITIAL_CONVERSATION_STATE,
      phase: 'error' as const,
      status: 'processing' as const,
      revision: 9,
      streamText: 'partial',
      activity: [{ kind: 'reasoning' as const, text: 'thinking' }],
      needsSnapshot: true,
      resnapshotFailures: 2,
      error: { code: 'X', message: 'x', retryable: true },
    };
    const next = conversationReducer(dirty, {
      type: 'snapshot',
      snapshot: snapshot({
        status: 'completed',
        revision: 4,
        unreadCount: 2,
        messages: [message('m1', 4, 'assistant')],
        hasOlderMessages: true,
      }),
    });
    expect(next).toMatchObject({
      phase: 'ready',
      status: 'completed',
      revision: 4,
      unreadCount: 2,
      hasOlderMessages: true,
      streamText: '',
      activity: [],
      needsSnapshot: false,
      resnapshotFailures: 0,
      error: null,
    });
  });

  it('uses Host id as canonical and client id to reconcile send/event/replay', () => {
    let state = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot({ revision: 1 }),
    });
    state = conversationReducer(state, {
      type: 'send-result',
      result: {
        accepted: true,
        duplicate: false,
        message: message('host-1', 2, 'user', 'client-1'),
      },
    });
    state = conversationReducer(state, {
      type: 'event',
      event: {
        type: 'message',
        revision: 3,
        message: { ...message('host-1', 3, 'user', 'client-1'), content: 'authoritative' },
      },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe('authoritative');
  });

  it('does not append unknown stale messages or regress scalar state', () => {
    const ready = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot({ status: 'completed', revision: 10, unreadCount: 0 }),
    });
    const staleStatus = conversationReducer(ready, {
      type: 'event',
      event: { type: 'status', revision: 9, status: 'processing' },
    });
    const staleMessage = conversationReducer(staleStatus, {
      type: 'event',
      event: { type: 'message', revision: 9, message: message('unknown', 9) },
    });
    expect(staleMessage.status).toBe('completed');
    expect(staleMessage.messages).toHaveLength(0);
  });

  it.each<HostLocalChannelEvent>([
    { type: 'status', revision: 3, status: 'processing' },
    { type: 'resnapshot-required', code: 'RESNAPSHOT_REQUIRED' },
  ])('requests an authoritative replacement for gaps/resnapshot: $type', (event) => {
    const ready = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot({ revision: 1 }),
    });
    expect(conversationReducer(ready, { type: 'event', event }).needsSnapshot).toBe(true);
  });

  it('bounds stream text and activity, then clears them on durable output', () => {
    let state = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot(),
    });
    for (let revision = 1; revision <= 20; revision += 1) {
      state = conversationReducer(state, {
        type: 'event',
        event: {
          type: 'stream',
          revision,
          stream: { type: 'reasoning', text: `reason-${revision}` },
        },
      });
    }
    state = conversationReducer(state, {
      type: 'event',
      event: {
        type: 'stream',
        revision: 21,
        stream: { type: 'text', delta: '界'.repeat(MAX_STREAM_UTF8_BYTES) },
      },
    });
    expect(state.activity).toHaveLength(MAX_ACTIVITY_ITEMS);
    expect(utf8Bytes(state.streamText)).toBeLessThanOrEqual(MAX_STREAM_UTF8_BYTES);
    state = conversationReducer(state, {
      type: 'event',
      event: { type: 'message', revision: 22, message: message('assistant', 22, 'assistant') },
    });
    expect(state.streamText).toBe('');
    expect(state.activity).toEqual([]);
  });

  it('bounds oversized activity fields and aggregate serialized UTF-8 bytes', () => {
    const oversized = `${'\u0000'.repeat(256 * 1024)}${'界'.repeat(256 * 1024)}`;
    let state = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot(),
    });
    for (let revision = 1; revision <= MAX_ACTIVITY_ITEMS + 4; revision += 1) {
      state = conversationReducer(state, {
        type: 'event',
        event: {
          type: 'stream',
          revision,
          stream:
            revision % 2 === 0
              ? { type: 'reasoning', text: oversized }
              : {
                  type: 'tool',
                  phase: 'start',
                  name: oversized,
                  status: 'running',
                  summary: oversized,
                },
        },
      });
    }
    expect(state.activity.length).toBeGreaterThan(0);
    expect(state.activity.length).toBeLessThanOrEqual(MAX_ACTIVITY_ITEMS);
    for (const item of state.activity) {
      expect(utf8Bytes(item.text)).toBeLessThanOrEqual(MAX_ACTIVITY_ITEM_UTF8_BYTES);
    }
    expect(utf8Bytes(JSON.stringify(state.activity))).toBeLessThanOrEqual(
      MAX_ACTIVITY_SERIALIZED_UTF8_BYTES
    );
  });

  it('preserves transcript on recoverable error and bounds retry failures', () => {
    let state = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'snapshot',
      snapshot: snapshot({ messages: [message('kept', 1)], revision: 1 }),
    });
    for (let index = 0; index < 5; index += 1) {
      state = conversationReducer(state, { type: 'resnapshot-failed', message: 'offline' });
    }
    expect(state.messages[0]?.id).toBe('kept');
    expect(state.resnapshotFailures).toBe(3);
    expect(state.error?.retryable).toBe(false);
  });

  it('moves revoked conversations to a disabled unavailable state', () => {
    const state = conversationReducer(INITIAL_CONVERSATION_STATE, {
      type: 'event',
      event: { type: 'revoked', code: 'ENDPOINT_UNAVAILABLE' },
    });
    expect(state.phase).toBe('revoked');
    expect(state.error?.code).toBe('ENDPOINT_UNAVAILABLE');
  });
});
