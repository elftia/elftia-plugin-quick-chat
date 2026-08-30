import type {
  HostLocalChannelMessage,
  HostThemeSnapshot,
  QuickChatWindowCloseIntent,
  QuickChatWindowLocalChannel,
} from '@elftia/plugin-types';
import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

import { MAX_MESSAGES, MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES } from '../shared/constants';
import { ConversationSession } from './conversation-session';
import {
  INITIAL_CONVERSATION_STATE,
  serializedUtf8Bytes,
  takeProjectedTextPrefix,
  type ConversationState,
} from './conversation-state';
import { translate } from './localization';
import { isNormalizedSubmitIntent } from './submission';
import { QUICK_CHAT_STYLES } from './styles';

export interface ThemeStore {
  readonly getSnapshot: () => HostThemeSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

interface QuickChatApplicationProps {
  readonly localChannel: QuickChatWindowLocalChannel;
  readonly close: QuickChatWindowCloseIntent;
  readonly themeStore: ThemeStore;
  readonly locale: string;
  readonly isDisposed: () => boolean;
}

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

function readEventValue(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const target = (event as { readonly target?: unknown }).target;
  if (!target || typeof target !== 'object') return '';
  const value = (target as { readonly value?: unknown }).value;
  return typeof value === 'string' ? value : '';
}

export function QuickChatApplication({
  localChannel,
  close,
  themeStore,
  locale,
  isDisposed,
}: QuickChatApplicationProps): ReactElement {
  const h = React.createElement;
  const [state, setState] = React.useState<ConversationState>(INITIAL_CONVERSATION_STATE);
  const [session, setSession] = React.useState<ConversationSession | null>(null);
  const [draft, setDraft] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [composerError, setComposerError] = React.useState<string | null>(null);
  const draftRef = React.useRef('');
  const draftRevisionRef = React.useRef(0);
  const sendFlightRef = React.useRef<Promise<void> | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = React.useRef<HTMLElement | null>(null);
  const tailRef = React.useRef<HTMLSpanElement | null>(null);
  const didAutofocusRef = React.useRef(false);
  const theme = React.useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot
  );

  React.useEffect(() => {
    const next = new ConversationSession(localChannel, (nextState) => {
      if (!isDisposed()) setState(nextState);
    });
    if (!isDisposed()) setSession(next);
    void next.start();
    return () => {
      setSession(null);
      void next.dispose();
    };
  }, [isDisposed, localChannel]);

  React.useEffect(() => {
    if (didAutofocusRef.current || isDisposed() || state.phase === 'loading') return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    didAutofocusRef.current = true;
    composerRef.current?.focus({ preventScroll: true });
  }, [isDisposed, state.phase]);

  React.useLayoutEffect(() => {
    if (isDisposed()) return;
    const tail = tailRef.current;
    if (tail && typeof tail.scrollIntoView === 'function') {
      tail.scrollIntoView({ block: 'end' });
      return;
    }
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [isDisposed, state.activity.length, state.messages.length, state.revision, state.streamText]);

  const unavailable = state.phase === 'revoked' || state.status === 'suspended';
  const canSend = Boolean(session) && !unavailable && !pending && state.phase !== 'loading';
  const copy = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const updateDraft = (value: string): void => {
    draftRef.current = value;
    draftRevisionRef.current += 1;
    setDraft(value);
  };

  const send = (): Promise<void> => {
    if (sendFlightRef.current) return sendFlightRef.current;
    if (!session || !canSend || isDisposed()) return Promise.resolve();
    const submittedDraft = draftRef.current;
    const submittedRevision = draftRevisionRef.current;
    setPending(true);
    setComposerError(null);
    const flight = (async (): Promise<void> => {
      const result = await session.submit(submittedDraft);
      if (isDisposed()) return;
      if (result.state === 'accepted' || result.state === 'duplicate') {
        if (draftRevisionRef.current === submittedRevision && draftRef.current === submittedDraft) {
          draftRef.current = '';
          setDraft('');
        }
        return;
      }
      if (result.state === 'invalid') {
        setComposerError(
          result.message === 'too-large' ? copy('draftTooLarge') : copy('draftBlank')
        );
      } else if (result.state === 'uncertain') {
        setComposerError(copy('uncertain'));
      }
    })().finally(() => {
      if (sendFlightRef.current !== flight) return;
      sendFlightRef.current = null;
      if (!isDisposed()) setPending(false);
    });
    sendFlightRef.current = flight;
    return flight;
  };

  const retry = async (): Promise<void> => {
    if (!session || isDisposed()) return;
    if (session.canRetrySubmission(draft)) await send();
    else if (state.phase === 'revoked' || state.status === 'suspended' || !session.isAttached()) {
      await session.reattach();
    } else {
      await session.refresh();
    }
  };

  const statusKey =
    state.phase === 'loading'
      ? 'loading'
      : state.phase === 'revoked'
        ? 'unavailable'
        : state.phase === 'error' || state.status === 'error'
          ? 'error'
          : state.status === 'processing'
            ? 'processing'
            : state.status === 'suspended'
              ? 'suspended'
              : state.status === 'completed'
                ? 'completed'
                : state.status === 'interrupted'
                  ? 'interrupted'
                  : 'idle';
  const transcript = selectRenderableMessages(state.messages);
  const transcriptChildren: ReactNode[] = [];

  if (state.hasOlderMessages) {
    transcriptChildren.push(
      h(
        'p',
        {
          key: 'older',
          className: 'quick-chat-notice',
          'data-testid': 'quick-chat-older-history',
        },
        copy('older')
      )
    );
  }
  if (transcript.omitted) {
    transcriptChildren.push(
      h(
        'p',
        {
          key: 'omitted',
          className: 'quick-chat-notice',
          'data-testid': 'quick-chat-budget-notice',
        },
        copy('omitted')
      )
    );
  }
  for (const message of transcript.messages) {
    const label = message.role === 'user' ? copy('user') : copy('assistant');
    transcriptChildren.push(
      h(
        'article',
        {
          key: message.id,
          className: `quick-chat-message quick-chat-message-${message.role}`,
          'data-testid': `quick-chat-message-${message.role}`,
          'aria-label': label,
        },
        h('h2', null, label),
        h('p', null, message.content)
      )
    );
  }
  if (state.streamText || state.activity.length > 0) {
    transcriptChildren.push(
      h(
        'section',
        {
          key: 'stream',
          className: 'quick-chat-stream',
          'data-testid': 'quick-chat-stream',
          'aria-label': copy('stream'),
        },
        h('h2', null, copy('stream')),
        state.streamText ? h('p', null, state.streamText) : null,
        ...state.activity.map((item, index) => h('p', { key: `${item.kind}-${index}` }, item.text))
      )
    );
  }
  transcriptChildren.push(
    h('span', {
      key: 'tail',
      ref: tailRef,
      'data-testid': 'quick-chat-transcript-tail',
      'aria-hidden': true,
    })
  );

  return h(
    'main',
    {
      className: 'quick-chat-window',
      'data-theme': theme.resolvedMode,
      'data-testid': 'quick-chat-root',
      'aria-label': copy('title'),
    },
    h('style', { 'data-testid': 'quick-chat-styles' }, QUICK_CHAT_STYLES),
    h(
      'header',
      { className: 'quick-chat-chrome', 'data-testid': 'quick-chat-chrome' },
      h('h1', null, copy('title')),
      h(
        'button',
        {
          type: 'button',
          className: 'quick-chat-close quick-chat-no-drag',
          'aria-label': copy('close'),
          'data-testid': 'quick-chat-close',
          onClick: () => void close.request().catch(() => undefined),
        },
        '×'
      )
    ),
    h(
      'p',
      {
        className: 'quick-chat-status quick-chat-no-drag',
        role: 'status',
        'aria-live': 'polite',
        'data-testid': 'quick-chat-state',
      },
      copy(statusKey)
    ),
    state.messages.length === 0 && state.phase === 'ready' && state.status === 'idle'
      ? h('p', { className: 'quick-chat-empty', 'data-testid': 'quick-chat-empty' }, copy('empty'))
      : null,
    h(
      'section',
      {
        ref: transcriptRef,
        className: 'quick-chat-transcript quick-chat-no-drag',
        role: 'log',
        'aria-live': 'polite',
        'aria-label': copy('transcript'),
        'data-testid': 'quick-chat-transcript',
      },
      ...transcriptChildren
    ),
    h(
      'section',
      {
        className: 'quick-chat-composer quick-chat-no-drag',
        role: 'group',
        'aria-label': copy('composer'),
        'data-testid': 'quick-chat-composer',
      },
      h('textarea', {
        ref: composerRef,
        value: draft,
        disabled: !canSend,
        placeholder: copy('placeholder'),
        'aria-label': copy('placeholder'),
        'aria-disabled': !canSend,
        'data-testid': 'quick-chat-composer-input',
        onChange: (event: unknown) => updateDraft(readEventValue(event)),
        onKeyDown: (event: unknown) => {
          if (isNormalizedSubmitIntent(event)) void send();
        },
      }),
      h(
        'div',
        { className: 'quick-chat-actions' },
        h(
          'button',
          {
            type: 'button',
            disabled: !canSend,
            onClick: () => void send(),
            'aria-label': copy('send'),
            'data-testid': 'quick-chat-send',
          },
          copy('send')
        ),
        state.status === 'processing' && state.phase !== 'revoked'
          ? h(
              'button',
              {
                type: 'button',
                onClick: () => void session?.stop(),
                'aria-label': copy('stop'),
                'data-testid': 'quick-chat-stop',
              },
              copy('stop')
            )
          : null,
        state.error?.retryable || state.status === 'suspended'
          ? h(
              'button',
              {
                type: 'button',
                onClick: () => void retry(),
                'aria-label': copy('retry'),
                'data-testid': 'quick-chat-retry',
              },
              copy('retry')
            )
          : null
      ),
      composerError
        ? h(
            'p',
            {
              className: 'quick-chat-composer-error',
              role: 'status',
              'aria-live': 'polite',
              'data-testid': 'quick-chat-composer-error',
            },
            composerError
          )
        : null
    )
  );
}
