import type {
  HostLocalChannelClient,
  HostLocalChannelEvent,
  HostLocalChannels,
} from '@elftia/plugin-types';

import { CHAT_ID, ENDPOINT_ID } from '../shared/constants';
import {
  conversationReducer,
  INITIAL_CONVERSATION_STATE,
  type ConversationState,
} from './conversation-state';
import { LogicalSubmission, type SubmitOutcome } from './submission';

export class ConversationSession {
  private state: ConversationState = INITIAL_CONVERSATION_STATE;
  private client: HostLocalChannelClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private submission: LogicalSubmission | null = null;
  private initialReady = false;
  private bufferedEvents: HostLocalChannelEvent[] = [];
  private refreshPromise: Promise<void> | null = null;
  private refreshClient: HostLocalChannelClient | null = null;
  private refreshEpoch = 0;
  private refreshQueued = false;
  private lifecyclePromise: Promise<void> | null = null;
  private lifecycleEpoch = 0;
  private disposed = false;

  constructor(
    private readonly channels: HostLocalChannels,
    private readonly onState: (state: ConversationState) => void,
    private readonly idFactory?: () => string
  ) {}

  getState(): ConversationState {
    return this.state;
  }

  start(): Promise<void> {
    if (!this.disposed && this.client) return Promise.resolve();
    this.disposed = false;
    return this.beginLifecycle(false);
  }

  reattach(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.beginLifecycle(true);
  }

  async refresh(): Promise<void> {
    const client = this.client;
    const epoch = this.lifecycleEpoch;
    if (this.disposed || !client) return;
    if (this.refreshPromise && this.refreshClient === client && this.refreshEpoch === epoch) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    const refreshPromise = (async () => {
      do {
        this.refreshQueued = false;
        try {
          const snapshot = await client.getSnapshot();
          if (!this.isCurrent(epoch, client)) return;
          if (snapshot.chatId !== CHAT_ID) throw new Error('Host returned another chat snapshot');
          this.dispatchCurrent(epoch, client, { type: 'snapshot', snapshot });
          await this.markRead(epoch, client);
        } catch {
          if (!this.isCurrent(epoch, client)) return;
          this.dispatchCurrent(epoch, client, {
            type: 'resnapshot-failed',
            message: 'Snapshot refresh failed.',
          });
          break;
        }
      } while (this.shouldContinueRefresh(epoch, client));
    })();
    this.refreshPromise = refreshPromise;
    this.refreshClient = client;
    this.refreshEpoch = epoch;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
        this.refreshClient = null;
        this.refreshEpoch = 0;
        this.refreshQueued = false;
      }
    }
  }

  async submit(text: string): Promise<SubmitOutcome> {
    if (this.state.phase === 'revoked' || this.state.status === 'suspended') {
      return { state: 'invalid', message: 'unavailable' };
    }
    const client = this.client;
    const submission = this.submission;
    const epoch = this.lifecycleEpoch;
    if (!client || !submission) return { state: 'invalid', message: 'not-attached' };
    const outcome = await submission.submit(text);
    if (outcome.state === 'uncertain' && this.isCurrent(epoch, client, submission)) {
      this.dispatchCurrent(epoch, client, {
        type: 'transport-error',
        code: 'SEND_UNCERTAIN',
        message: 'Message acceptance is uncertain.',
        retryable: true,
      });
    }
    return outcome;
  }

  isSubmitPending(): boolean {
    return this.submission?.isPending() ?? false;
  }

  isAttached(): boolean {
    return !this.disposed && this.client !== null;
  }

  canRetrySubmission(text: string): boolean {
    return this.submission?.canRetry(text) ?? false;
  }

  async stop(): Promise<void> {
    const client = this.client;
    const epoch = this.lifecycleEpoch;
    if (!client || this.state.status !== 'processing' || this.state.phase === 'revoked') return;
    try {
      await client.stop();
    } catch {
      if (!this.isCurrent(epoch, client)) return;
      this.dispatchCurrent(epoch, client, {
        type: 'transport-error',
        code: 'STOP_FAILED',
        message: 'The response could not be stopped.',
        retryable: true,
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleEpoch += 1;
    await this.releaseClient();
  }

  private dispatch(action: Parameters<typeof conversationReducer>[1]): void {
    if (this.disposed) return;
    this.state = conversationReducer(this.state, action);
    this.onState(this.state);
    if (this.state.needsSnapshot) void this.refresh();
  }

  private dispatchCurrent(
    epoch: number,
    client: HostLocalChannelClient,
    action: Parameters<typeof conversationReducer>[1]
  ): void {
    if (!this.isCurrent(epoch, client)) return;
    this.dispatch(action);
  }

  private shouldContinueRefresh(epoch: number, client: HostLocalChannelClient): boolean {
    return this.isCurrent(epoch, client) && (this.refreshQueued || this.state.needsSnapshot);
  }

  private isCurrent(
    epoch: number,
    client: HostLocalChannelClient,
    submission?: LogicalSubmission
  ): boolean {
    return (
      !this.disposed &&
      this.lifecycleEpoch === epoch &&
      this.client === client &&
      (submission === undefined || this.submission === submission)
    );
  }

  private handleEvent(
    epoch: number,
    client: HostLocalChannelClient,
    event: HostLocalChannelEvent
  ): void {
    if (!this.isCurrent(epoch, client)) return;
    if (!this.initialReady) {
      this.bufferedEvents.push(event);
      return;
    }
    this.dispatch({ type: 'event', event });
  }

  private beginLifecycle(releaseCurrent: boolean): Promise<void> {
    if (this.lifecyclePromise) return this.lifecyclePromise;
    const epoch = this.lifecycleEpoch + 1;
    this.lifecycleEpoch = epoch;
    const lifecyclePromise = this.performLifecycle(epoch, releaseCurrent).finally(() => {
      if (this.lifecyclePromise === lifecyclePromise) this.lifecyclePromise = null;
    });
    this.lifecyclePromise = lifecyclePromise;
    return lifecyclePromise;
  }

  private async performLifecycle(epoch: number, releaseCurrent: boolean): Promise<void> {
    if (releaseCurrent) await this.releaseClient();
    if (this.disposed || this.lifecycleEpoch !== epoch) return;
    if (releaseCurrent || this.state.phase !== 'loading') this.dispatch({ type: 'loading' });
    await this.connect(epoch);
  }

  private async connect(epoch: number): Promise<void> {
    let attachedClient: HostLocalChannelClient | null = null;
    try {
      const client = await this.channels.attach({ endpointId: ENDPOINT_ID, chatId: CHAT_ID });
      attachedClient = client;
      if (this.disposed || this.lifecycleEpoch !== epoch) {
        await this.detachClient(client);
        return;
      }
      this.client = client;
      this.initialReady = false;
      this.bufferedEvents = [];
      this.unsubscribe = client.subscribe((event) => this.handleEvent(epoch, client, event));
      const submission = new LogicalSubmission(
        client,
        (result) => {
          if (this.isCurrent(epoch, client, submission)) {
            this.dispatchCurrent(epoch, client, { type: 'send-result', result });
          }
        },
        this.idFactory
      );
      this.submission = submission;
      const snapshot = await client.getSnapshot();
      if (!this.isCurrent(epoch, client)) return;
      if (snapshot.chatId !== CHAT_ID) throw new Error('Host returned another chat snapshot');
      this.dispatchCurrent(epoch, client, { type: 'snapshot', snapshot });
      this.initialReady = true;
      const buffered = this.bufferedEvents;
      this.bufferedEvents = [];
      for (const event of buffered) {
        if (!this.isCurrent(epoch, client)) return;
        this.dispatchCurrent(epoch, client, { type: 'event', event });
      }
      await this.markRead(epoch, client);
    } catch {
      if (this.disposed || this.lifecycleEpoch !== epoch) return;
      if (attachedClient && this.client !== attachedClient) {
        await this.detachClient(attachedClient);
      } else if (attachedClient) {
        await this.releaseClient();
      }
      this.dispatch({
        type: 'transport-error',
        code: 'ATTACH_FAILED',
        message: 'Quick Chat attachment failed.',
        retryable: true,
      });
    }
  }

  private async markRead(epoch: number, client: HostLocalChannelClient): Promise<void> {
    if (!this.isCurrent(epoch, client)) return;
    try {
      await client.markRead();
    } catch {
      if (!this.isCurrent(epoch, client)) return;
      this.dispatchCurrent(epoch, client, {
        type: 'transport-error',
        code: 'MARK_READ_FAILED',
        message: 'The conversation could not be marked as read.',
        retryable: true,
      });
    }
  }

  private async releaseClient(): Promise<void> {
    const unsubscribe = this.unsubscribe;
    const client = this.client;
    this.unsubscribe = null;
    this.client = null;
    this.submission = null;
    this.initialReady = false;
    this.bufferedEvents = [];
    this.refreshPromise = null;
    this.refreshClient = null;
    this.refreshEpoch = 0;
    this.refreshQueued = false;
    try {
      unsubscribe?.();
    } catch {
      // Best-effort teardown still detaches the Host client.
    }
    if (client) await this.detachClient(client);
  }

  private async detachClient(client: HostLocalChannelClient): Promise<void> {
    try {
      await client.detach();
    } catch {
      // Detach is best effort and must never reject into the renderer.
    }
  }
}
