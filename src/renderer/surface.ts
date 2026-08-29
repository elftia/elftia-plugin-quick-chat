import type {
  AgentUiQuickChatHostApi,
  HostButtonProps,
  HostLocalChannelMessage,
  HostThemeSnapshot,
} from '@elftia/plugin-types';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';

import {
  MAX_MESSAGES,
  MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES,
  SURFACE_ID,
} from '../shared/constants';
import { ConversationSession } from './conversation-session';
import {
  INITIAL_CONVERSATION_STATE,
  serializedUtf8Bytes,
  takeProjectedTextPrefix,
  type ConversationState,
} from './conversation-state';
import { translate } from './localization';
import { isNormalizedSubmitIntent } from './submission';

export interface ThemeStore {
  readonly getSnapshot: () => HostThemeSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}

type QuickChatSurfaceHost = Pick<AgentUiQuickChatHostApi, 'localChannels' | 'react' | 'ui'>;

export interface RenderableTranscript {
  readonly messages: readonly HostLocalChannelMessage[];
  readonly omitted: boolean;
}

export function selectRenderableMessages(
  messages: readonly HostLocalChannelMessage[]
): RenderableTranscript {
  const bounded = messages.slice(-MAX_MESSAGES);
  const selected: HostLocalChannelMessage[] = [];
  let remaining = MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES;
  let omitted = messages.length > bounded.length;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const message = bounded[index];
    if (!message) continue;
    const size = serializedUtf8Bytes(message.content);
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

export function createQuickChatSurface(
  host: QuickChatSurfaceHost,
  themeStore: ThemeStore,
  locale: string
): FunctionComponent<Record<string, never>> {
  const React = host.react.instance;
  const h = React.createElement;
  const Button = host.ui.Button as FunctionComponent<HostButtonProps>;

  function QuickChatSurface(): ReactElement {
    const [state, setState] = React.useState<ConversationState>(INITIAL_CONVERSATION_STATE);
    const [session, setSession] = React.useState<ConversationSession | null>(null);
    const [draft, setDraft] = React.useState('');
    const [pending, setPending] = React.useState(false);
    const [composerError, setComposerError] = React.useState<string | null>(null);
    const draftRef = React.useRef('');
    const draftRevisionRef = React.useRef(0);
    const sendFlightRef = React.useRef<Promise<void> | null>(null);
    const theme = React.useSyncExternalStore(
      themeStore.subscribe,
      themeStore.getSnapshot,
      themeStore.getSnapshot
    );
    void theme.resolvedMode;

    React.useEffect(() => {
      const next = new ConversationSession(host.localChannels, setState);
      setSession(next);
      void next.start();
      return () => {
        setSession(null);
        void next.dispose();
      };
    }, []);

    const unavailable = state.phase === 'revoked' || state.status === 'suspended';
    const canSend = !unavailable && !pending && state.phase !== 'loading';
    const copy = (key: Parameters<typeof translate>[1]) => translate(locale, key);

    const updateDraft = (value: string): void => {
      draftRef.current = value;
      draftRevisionRef.current += 1;
      setDraft(value);
    };

    const send = (): Promise<void> => {
      if (sendFlightRef.current) return sendFlightRef.current;
      if (!session || !canSend) return Promise.resolve();
      const submittedDraft = draftRef.current;
      const submittedRevision = draftRevisionRef.current;
      setPending(true);
      setComposerError(null);
      const flight = (async (): Promise<void> => {
        const result = await session.submit(submittedDraft);
        if (result.state === 'accepted' || result.state === 'duplicate') {
          if (
            draftRevisionRef.current === submittedRevision &&
            draftRef.current === submittedDraft
          ) {
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
        setPending(false);
      });
      sendFlightRef.current = flight;
      return flight;
    };

    const retry = async (): Promise<void> => {
      if (!session) return;
      if (session.canRetrySubmission(draft)) await send();
      else if (state.phase === 'revoked' || state.status === 'suspended' || !session.isAttached())
        await session.reattach();
      else await session.refresh();
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
        h('p', { key: 'older', 'data-testid': 'quick-chat-older-history' }, copy('older'))
      );
    }
    if (transcript.omitted) {
      transcriptChildren.push(
        h('p', { key: 'omitted', 'data-testid': 'quick-chat-budget-notice' }, copy('omitted'))
      );
    }
    for (const message of transcript.messages) {
      const label = message.role === 'user' ? copy('user') : copy('assistant');
      transcriptChildren.push(
        h(
          'article',
          {
            key: message.id,
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
          { key: 'stream', 'data-testid': 'quick-chat-stream', 'aria-label': copy('stream') },
          h('h2', null, copy('stream')),
          state.streamText ? h('p', null, state.streamText) : null,
          ...state.activity.map((item, index) =>
            h('p', { key: `${item.kind}-${index}` }, item.text)
          )
        )
      );
    }
    transcriptChildren.push(
      h('span', { key: 'tail', 'data-testid': 'quick-chat-transcript-tail', 'aria-hidden': true })
    );

    return h(
      'main',
      { 'data-testid': 'quick-chat-root', 'aria-label': copy('title') },
      h('h1', null, copy('title')),
      h(
        'p',
        {
          role: 'status',
          'aria-live': 'polite',
          'data-testid': 'quick-chat-state',
        },
        copy(statusKey)
      ),
      state.messages.length === 0 && state.phase === 'ready' && state.status === 'idle'
        ? h('p', { 'data-testid': 'quick-chat-empty' }, copy('empty'))
        : null,
      h(
        'section',
        {
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
          role: 'group',
          'aria-label': copy('composer'),
          'data-testid': 'quick-chat-composer',
        },
        h('textarea', {
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
          Button,
          {
            disabled: !canSend,
            onClick: () => void send(),
            'aria-label': copy('send'),
            'data-testid': 'quick-chat-send',
            variant: 'default',
            size: 'sm',
          },
          copy('send')
        ),
        state.status === 'processing' && state.phase !== 'revoked'
          ? h(
              Button,
              {
                onClick: () => void session?.stop(),
                'aria-label': copy('stop'),
                'data-testid': 'quick-chat-stop',
                variant: 'secondary',
                size: 'sm',
              },
              copy('stop')
            )
          : null,
        state.error?.retryable || state.status === 'suspended'
          ? h(
              Button,
              {
                onClick: () => void retry(),
                'aria-label': copy('retry'),
                'data-testid': 'quick-chat-retry',
                variant: 'outline',
                size: 'sm',
              },
              copy('retry')
            )
          : null,
        composerError
          ? h(
              'p',
              { role: 'status', 'aria-live': 'polite', 'data-testid': 'quick-chat-composer-error' },
              composerError
            )
          : null
      )
    );
  }

  Object.defineProperty(QuickChatSurface, 'name', { value: `QuickChatSurface_${SURFACE_ID}` });
  return QuickChatSurface;
}
