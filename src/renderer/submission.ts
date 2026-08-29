import type { HostLocalChannelClient, HostLocalChannelSendResult } from '@elftia/plugin-types';

import { MAX_DRAFT_UTF8_BYTES } from '../shared/constants';
import { utf8Bytes } from './conversation-state';

export interface NormalizedSubmitIntent {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly isComposing?: boolean;
}

export interface SubmitOutcome {
  readonly state: 'accepted' | 'duplicate' | 'invalid' | 'pending' | 'uncertain';
  readonly message?: string;
  readonly result?: HostLocalChannelSendResult;
}

export function isNormalizedSubmitIntent(value: unknown): value is NormalizedSubmitIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Record<string, unknown>;
  if (intent.key !== 'Enter') return false;
  for (const key of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
    if (intent[key] !== undefined && typeof intent[key] !== 'boolean') return false;
  }
  return (
    !intent.shiftKey && !intent.ctrlKey && !intent.altKey && !intent.metaKey && !intent.isComposing
  );
}

function defaultIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

export class LogicalSubmission {
  private pending = false;
  private uncertain: { readonly text: string; readonly clientMessageId: string } | null = null;

  constructor(
    private readonly client: Pick<HostLocalChannelClient, 'send'>,
    private readonly onAccepted: (result: HostLocalChannelSendResult) => void,
    private readonly idFactory: () => string = defaultIdFactory
  ) {}

  isPending(): boolean {
    return this.pending;
  }

  canRetry(text: string): boolean {
    return this.uncertain?.text === text;
  }

  async submit(text: string): Promise<SubmitOutcome> {
    if (this.pending) return { state: 'pending' };
    if (text.trim().length === 0) return { state: 'invalid', message: 'blank' };
    if (utf8Bytes(text) > MAX_DRAFT_UTF8_BYTES) {
      return { state: 'invalid', message: 'too-large' };
    }

    const logical =
      this.uncertain?.text === text ? this.uncertain : { text, clientMessageId: this.idFactory() };
    this.pending = true;
    try {
      const result = await this.client.send(logical);
      if (!result.accepted && !result.duplicate) {
        throw new Error('Host did not accept or identify a duplicate message');
      }
      this.uncertain = null;
      this.onAccepted(result);
      return { state: result.duplicate ? 'duplicate' : 'accepted', result };
    } catch (error) {
      this.uncertain = logical;
      return {
        state: 'uncertain',
        message: error instanceof Error ? error.message : 'send failed',
      };
    } finally {
      this.pending = false;
    }
  }
}
