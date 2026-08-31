import type {
  HostThemeSnapshot,
  QuickChatWindowCloseIntent,
  QuickChatWindowLocalChannel,
} from '@elftia/plugin-types';
import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ConversationSession } from './conversation-session';
import { INITIAL_CONVERSATION_STATE, type ConversationState } from './conversation-state';
import { BotIcon, CloseIcon, RetryIcon, SendIcon, StopIcon, UserIcon } from './icons';
import { translate } from './localization';
import { isNormalizedSubmitIntent } from './submission';
import { QUICK_CHAT_STYLES } from './styles';
import { selectRenderableMessages } from './transcript-projection';

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
  const canEdit = Boolean(session) && !unavailable && state.phase !== 'loading';
  const canSend = canEdit && !pending && state.status !== 'processing';
  const sendDisabled = !canSend || draft.trim().length === 0;
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
  const isEmpty =
    state.messages.length === 0 &&
    !state.streamText &&
    state.activity.length === 0 &&
    state.phase === 'ready' &&
    state.status === 'idle';

  if (isEmpty) {
    transcriptChildren.push(
      h(
        'section',
        { key: 'empty', className: 'quick-chat-empty', 'data-testid': 'quick-chat-empty' },
        h('span', { className: 'quick-chat-empty-icon', 'aria-hidden': true }, h(BotIcon, {})),
        h('h2', null, copy('empty'))
      )
    );
  }

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
    const isUser = message.role === 'user';
    const label = message.role === 'user' ? copy('user') : copy('assistant');
    transcriptChildren.push(
      h(
        'article',
        {
          key: message.id,
          className: `quick-chat-message-row quick-chat-message-${message.role}`,
          'data-testid': `quick-chat-message-${message.role}`,
          'aria-label': label,
        },
        h(
          'span',
          { className: 'quick-chat-avatar', 'aria-hidden': true },
          isUser ? h(UserIcon, {}) : h(BotIcon, {})
        ),
        h('div', { className: 'quick-chat-message-bubble' }, h('p', null, message.content))
      )
    );
  }
  if (state.streamText || state.activity.length > 0) {
    transcriptChildren.push(
      h(
        'article',
        {
          key: 'stream',
          className: 'quick-chat-message-row quick-chat-message-assistant quick-chat-stream',
          'data-testid': 'quick-chat-stream',
          'data-streaming': 'true',
          'data-stream-phase': state.streamText ? 'generating' : 'thinking',
          'aria-label': copy('stream'),
        },
        h('span', { className: 'quick-chat-avatar', 'aria-hidden': true }, h(BotIcon, {})),
        h(
          'div',
          { className: 'quick-chat-message-bubble' },
          state.streamText ? h('p', null, state.streamText) : null,
          ...state.activity.map((item, index) =>
            h('p', { key: `${item.kind}-${index}`, className: 'quick-chat-activity' }, item.text)
          ),
          h('span', { className: 'quick-chat-stream-cursor', 'aria-hidden': true })
        )
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
      h(
        'div',
        { className: 'quick-chat-identity' },
        h('span', { className: 'quick-chat-brand-mark', 'aria-hidden': true }, 'E'),
        h(
          'div',
          { className: 'quick-chat-identity-copy' },
          h('h1', null, copy('title')),
          h(
            'p',
            {
              className: 'quick-chat-subtitle',
              role: 'status',
              'aria-live': 'polite',
              'data-testid': 'quick-chat-state',
            },
            copy(statusKey)
          )
        )
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'quick-chat-close quick-chat-no-drag',
          'aria-label': copy('close'),
          'data-testid': 'quick-chat-close',
          onClick: () => void close.request().catch(() => undefined),
        },
        h(CloseIcon, {})
      )
    ),
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
      h(
        'div',
        { className: 'quick-chat-composer-row' },
        h('textarea', {
          ref: composerRef,
          value: draft,
          disabled: !canEdit,
          placeholder: copy('placeholder'),
          'aria-label': copy('placeholder'),
          'aria-disabled': !canEdit,
          'data-testid': 'quick-chat-composer-input',
          rows: 1,
          onChange: (event: unknown) => updateDraft(readEventValue(event)),
          onKeyDown: (event: unknown) => {
            if (isNormalizedSubmitIntent(event)) void send();
          },
        }),
        h(
          'div',
          { className: 'quick-chat-actions' },
          state.status === 'processing' && state.phase !== 'revoked'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'quick-chat-action quick-chat-stop',
                  onClick: () => void session?.stop(),
                  'aria-label': copy('stop'),
                  'data-testid': 'quick-chat-stop',
                },
                h(StopIcon, {})
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'quick-chat-action quick-chat-send',
                  disabled: sendDisabled,
                  onClick: () => void send(),
                  'aria-label': copy('send'),
                  'data-testid': 'quick-chat-send',
                },
                h(SendIcon, {})
              ),
          state.error?.retryable || state.status === 'suspended'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'quick-chat-retry',
                  onClick: () => void retry(),
                  'aria-label': copy('retry'),
                  'data-testid': 'quick-chat-retry',
                },
                h(RetryIcon, {}),
                h('span', null, copy('retry'))
              )
            : null
        )
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
