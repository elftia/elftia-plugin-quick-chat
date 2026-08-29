import type {
  HostLocalChannelEvent,
  HostLocalChannelMessage,
  HostLocalChannelSendResult,
  HostLocalChannelSnapshot,
  HostLocalChannelStatus,
  HostLocalChannelStreamEvent,
} from '@elftia/plugin-types';

import {
  ENDPOINT_ID,
  MAX_ACTIVITY_ITEMS,
  MAX_ACTIVITY_FIELD_SERIALIZED_UTF8_BYTES,
  MAX_ACTIVITY_FIELD_UTF8_BYTES,
  MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES,
  MAX_ACTIVITY_ITEM_UTF8_BYTES,
  MAX_ACTIVITY_SERIALIZED_UTF8_BYTES,
  MAX_MESSAGES,
  MAX_RESNAPSHOT_FAILURES,
  MAX_STREAM_SERIALIZED_UTF8_BYTES,
  MAX_STREAM_UTF8_BYTES,
} from '../shared/constants';

export interface StreamActivity {
  readonly kind: 'reasoning' | 'tool';
  readonly text: string;
}

export interface ConversationError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ConversationState {
  readonly phase: 'loading' | 'ready' | 'error' | 'revoked';
  readonly status: HostLocalChannelStatus;
  readonly revision: number;
  readonly unreadCount: number;
  readonly messages: readonly HostLocalChannelMessage[];
  readonly hasOlderMessages: boolean;
  readonly streamText: string;
  readonly activity: readonly StreamActivity[];
  readonly needsSnapshot: boolean;
  readonly requiredSnapshotRevision: number | null;
  readonly resnapshotFailures: number;
  readonly error: ConversationError | null;
}

export type ConversationAction =
  | { readonly type: 'snapshot'; readonly snapshot: HostLocalChannelSnapshot }
  | { readonly type: 'event'; readonly event: HostLocalChannelEvent }
  | { readonly type: 'send-result'; readonly result: HostLocalChannelSendResult }
  | { readonly type: 'loading' }
  | {
      readonly type: 'transport-error';
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | { readonly type: 'resnapshot-failed'; readonly message: string }
  | { readonly type: 'clear-error' };

export const INITIAL_CONVERSATION_STATE: ConversationState = Object.freeze({
  phase: 'loading',
  status: 'idle',
  revision: 0,
  unreadCount: 0,
  messages: Object.freeze([]),
  hasOlderMessages: false,
  streamText: '',
  activity: Object.freeze([]),
  needsSnapshot: false,
  requiredSnapshotRevision: null,
  resnapshotFailures: 0,
  error: null,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

export function takeUtf8Suffix(value: string, maximumBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  let start = bytes.byteLength - maximumBytes;
  while (start < bytes.byteLength) {
    const byte = bytes[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    start += 1;
  }
  return decoder.decode(bytes.slice(start));
}

export function takeUtf8Prefix(value: string, maximumBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  let end = Math.max(0, maximumBytes);
  while (end > 0) {
    const byte = bytes[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return decoder.decode(bytes.slice(0, end));
}

export function serializedUtf8Bytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function takeSerializedBounded(
  value: string,
  maximumRawBytes: number,
  maximumSerializedBytes: number,
  fromEnd: boolean
): string {
  const rawBounded = fromEnd
    ? takeUtf8Suffix(value, maximumRawBytes)
    : takeUtf8Prefix(value, maximumRawBytes);
  if (serializedUtf8Bytes(rawBounded) <= maximumSerializedBytes) return rawBounded;
  const codePoints = Array.from(rawBounded);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = fromEnd
      ? codePoints.slice(codePoints.length - middle).join('')
      : codePoints.slice(0, middle).join('');
    if (serializedUtf8Bytes(candidate) <= maximumSerializedBytes) low = middle;
    else high = middle - 1;
  }
  return fromEnd
    ? codePoints.slice(codePoints.length - low).join('')
    : codePoints.slice(0, low).join('');
}

export function takeProjectedTextPrefix(
  value: string,
  maximumRawBytes: number,
  maximumSerializedBytes: number
): string {
  return takeSerializedBounded(value, maximumRawBytes, maximumSerializedBytes, false);
}

function takeProjectedTextSuffix(
  value: string,
  maximumRawBytes: number,
  maximumSerializedBytes: number
): string {
  return takeSerializedBounded(value, maximumRawBytes, maximumSerializedBytes, true);
}

function canonicalIndex(
  messages: readonly HostLocalChannelMessage[],
  candidate: HostLocalChannelMessage
): number {
  const byHostId = messages.findIndex((message) => message.id === candidate.id);
  if (byHostId >= 0) return byHostId;
  if (!candidate.clientMessageId) return -1;
  return messages.findIndex(
    (message) =>
      message.clientMessageId !== null &&
      message.clientMessageId !== undefined &&
      message.clientMessageId === candidate.clientMessageId
  );
}

function reconcileMessage(
  messages: readonly HostLocalChannelMessage[],
  candidate: HostLocalChannelMessage,
  appendUnknown: boolean
): readonly HostLocalChannelMessage[] {
  const index = canonicalIndex(messages, candidate);
  if (index < 0) {
    return appendUnknown ? [...messages, candidate].slice(-MAX_MESSAGES) : messages;
  }
  const current = messages[index];
  if (!current) return messages;
  if (candidate.revision < current.revision && candidate.id === current.id) return messages;
  const output = [...messages];
  output[index] = candidate;
  return output;
}

function isTerminal(status: HostLocalChannelStatus): boolean {
  return status !== 'processing';
}

function activityFor(stream: HostLocalChannelStreamEvent): StreamActivity | null {
  const boundedField = (value: string): string =>
    takeProjectedTextPrefix(
      value,
      MAX_ACTIVITY_FIELD_UTF8_BYTES,
      MAX_ACTIVITY_FIELD_SERIALIZED_UTF8_BYTES
    );
  if (stream.type === 'reasoning') {
    return {
      kind: 'reasoning',
      text: takeProjectedTextPrefix(
        boundedField(stream.text),
        MAX_ACTIVITY_ITEM_UTF8_BYTES,
        MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES
      ),
    };
  }
  if (stream.type === 'tool') {
    const text = [stream.phase, stream.name, stream.status, stream.summary]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map(boundedField)
      .join(' · ');
    return {
      kind: 'tool',
      text: takeProjectedTextPrefix(
        text,
        MAX_ACTIVITY_ITEM_UTF8_BYTES,
        MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES
      ),
    };
  }
  return null;
}

function appendActivity(
  activity: readonly StreamActivity[],
  item: StreamActivity
): readonly StreamActivity[] {
  const bounded = [...activity, item].slice(-MAX_ACTIVITY_ITEMS);
  while (bounded.length > 0 && serializedUtf8Bytes(bounded) > MAX_ACTIVITY_SERIALIZED_UTF8_BYTES) {
    bounded.shift();
  }
  return bounded;
}

function applyFreshEvent(
  state: ConversationState,
  event: Exclude<HostLocalChannelEvent, { type: 'resnapshot-required' | 'revoked' }>
): ConversationState {
  if (event.type === 'message') {
    const clearsTransient = event.message.role === 'assistant';
    return {
      ...state,
      phase: 'ready',
      revision: event.revision,
      messages: reconcileMessage(state.messages, event.message, true),
      streamText: clearsTransient ? '' : state.streamText,
      activity: clearsTransient ? [] : state.activity,
      error: null,
    };
  }
  if (event.type === 'status') {
    return {
      ...state,
      phase: 'ready',
      revision: event.revision,
      status: event.status,
      streamText: isTerminal(event.status) ? '' : state.streamText,
      activity: isTerminal(event.status) ? [] : state.activity,
      error: null,
    };
  }
  if (event.type === 'unread') {
    return { ...state, revision: event.revision, unreadCount: event.unreadCount };
  }
  if (event.type === 'stream') {
    const item = activityFor(event.stream);
    return {
      ...state,
      phase: 'ready',
      revision: event.revision,
      status: 'processing',
      streamText:
        event.stream.type === 'text'
          ? takeProjectedTextSuffix(
              state.streamText + event.stream.delta,
              MAX_STREAM_UTF8_BYTES,
              MAX_STREAM_SERIALIZED_UTF8_BYTES
            )
          : state.streamText,
      activity: item ? appendActivity(state.activity, item) : state.activity,
    };
  }
  return {
    ...state,
    phase: 'error',
    revision: event.revision,
    error: { code: event.code, message: event.message, retryable: true },
  };
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction
): ConversationState {
  if (action.type === 'loading') return { ...state, phase: 'loading', error: null };
  if (action.type === 'clear-error') {
    return { ...state, phase: state.phase === 'revoked' ? 'revoked' : 'ready', error: null };
  }
  if (action.type === 'transport-error') {
    return {
      ...state,
      phase: 'error',
      error: { code: action.code, message: action.message, retryable: action.retryable },
    };
  }
  if (action.type === 'resnapshot-failed') {
    const failures = Math.min(state.resnapshotFailures + 1, MAX_RESNAPSHOT_FAILURES);
    return {
      ...state,
      phase: 'error',
      resnapshotFailures: failures,
      needsSnapshot: true,
      error: {
        code: 'SNAPSHOT_FAILED',
        message: action.message,
        retryable: failures < MAX_RESNAPSHOT_FAILURES,
      },
    };
  }
  if (action.type === 'snapshot') {
    const snapshot = action.snapshot;
    if (snapshot.endpointId !== ENDPOINT_ID) {
      return {
        ...state,
        phase: 'error',
        error: {
          code: 'SNAPSHOT_IDENTITY_MISMATCH',
          message: 'The Host returned a snapshot for another endpoint.',
          retryable: false,
        },
      };
    }
    return {
      phase: 'ready',
      status: snapshot.status,
      revision: snapshot.revision,
      unreadCount: snapshot.unreadCount,
      messages: snapshot.messages.slice(-MAX_MESSAGES),
      hasOlderMessages: snapshot.hasOlderMessages || snapshot.messages.length > MAX_MESSAGES,
      streamText: '',
      activity: [],
      needsSnapshot:
        state.requiredSnapshotRevision !== null &&
        snapshot.revision < state.requiredSnapshotRevision,
      requiredSnapshotRevision:
        state.requiredSnapshotRevision !== null &&
        snapshot.revision < state.requiredSnapshotRevision
          ? state.requiredSnapshotRevision
          : null,
      resnapshotFailures: 0,
      error: null,
    };
  }
  if (action.type === 'send-result') {
    return {
      ...state,
      phase: 'ready',
      revision: Math.max(state.revision, action.result.message.revision),
      messages: reconcileMessage(state.messages, action.result.message, true),
      error: null,
    };
  }

  const event = action.event;
  if (event.type === 'revoked') {
    return {
      ...state,
      phase: 'revoked',
      needsSnapshot: false,
      requiredSnapshotRevision: null,
      streamText: '',
      activity: [],
      error: { code: event.code, message: 'Quick Chat is unavailable.', retryable: true },
    };
  }
  if (event.type === 'resnapshot-required') {
    return { ...state, needsSnapshot: true };
  }
  if (state.needsSnapshot || event.revision > state.revision + 1) {
    return {
      ...state,
      needsSnapshot: true,
      requiredSnapshotRevision: Math.max(state.requiredSnapshotRevision ?? 0, event.revision),
    };
  }
  if (event.revision <= state.revision) {
    if (event.type !== 'message') return state;
    const messages = reconcileMessage(state.messages, event.message, false);
    return messages === state.messages ? state : { ...state, messages };
  }
  return applyFreshEvent(state, event);
}
