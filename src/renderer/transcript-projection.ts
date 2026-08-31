import type { HostLocalChannelMessage } from '@elftia/plugin-types';

import { MAX_MESSAGES, MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES } from '../shared/constants';
import { serializedUtf8Bytes, takeProjectedTextPrefix } from './conversation-state';

export interface RenderableTranscript {
  readonly messages: readonly HostLocalChannelMessage[];
  readonly omitted: boolean;
}

export function selectRenderableMessages(
  messages: readonly HostLocalChannelMessage[]
): RenderableTranscript {
  const bounded = messages.slice(-MAX_MESSAGES);
  const selected: HostLocalChannelMessage[] = [];
  let remaining = MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES - serializedUtf8Bytes([]);
  let omitted = messages.length > bounded.length;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const message = bounded[index];
    if (!message) continue;
    const separatorSize = selected.length === 0 ? 0 : 1;
    const size = serializedUtf8Bytes(message.content) + separatorSize;
    if (size <= remaining) {
      selected.push(message);
      remaining -= size;
      continue;
    }
    omitted = true;
    if (selected.length === 0 && remaining > 16) {
      selected.push({
        ...message,
        content: `${takeProjectedTextPrefix(message.content, remaining - 3, remaining - 3)}…`,
      });
    }
    break;
  }
  return { messages: selected.reverse(), omitted };
}
