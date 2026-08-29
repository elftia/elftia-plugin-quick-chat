import type { AgentUiQuickChatHostApi, HostThemeSnapshot } from '@elftia/plugin-types';

import { SURFACE_ID } from '../shared/constants';
import { QUICK_CHAT_NAMESPACE, QUICK_CHAT_RESOURCES, resolveLocale } from './localization';
import { createQuickChatSurface, type ThemeStore } from './surface';

const fallbackTheme = Object.freeze({
  resolvedMode: 'light',
  isDarkMode: false,
}) satisfies HostThemeSnapshot;
let disposers: (() => void)[] = [];

function drainDisposers(): void {
  const retained = disposers;
  disposers = [];
  for (const dispose of retained.reverse()) dispose();
}

function browserLocale(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language;
}

function createThemeStore(host: Partial<Pick<AgentUiQuickChatHostApi, 'theme'>>): ThemeStore {
  let snapshot = host.theme?.getSnapshot() ?? fallbackTheme;
  const listeners = new Set<() => void>();
  const unsubscribe = host.theme?.subscribe((next) => {
    snapshot = next;
    for (const listener of listeners) listener();
  });
  if (unsubscribe) disposers.push(unsubscribe);
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function activate(host: Partial<AgentUiQuickChatHostApi>): void {
  drainDisposers();
  const { i18n, localChannels, quickChat, react, ui } = host;
  if (!quickChat || !react || !ui) return;

  if (i18n) {
    disposers.push(i18n.registerNamespace(QUICK_CHAT_NAMESPACE, QUICK_CHAT_RESOURCES));
  }
  const themeStore = createThemeStore(host);
  const locale = resolveLocale(browserLocale());

  if (!localChannels) {
    const React = react.instance;
    const Unavailable = () =>
      React.createElement(
        'main',
        { 'data-testid': 'quick-chat-root', 'aria-label': translateFallback(locale, 'title') },
        React.createElement(
          'p',
          { role: 'status', 'data-testid': 'quick-chat-state' },
          translateFallback(locale, 'unavailable')
        )
      );
    disposers.push(
      quickChat.registerSurface({
        id: SURFACE_ID,
        render: Unavailable,
      })
    );
    return;
  }

  const Surface = createQuickChatSurface({ localChannels, react, ui }, themeStore, locale);
  disposers.push(
    quickChat.registerSurface({
      id: SURFACE_ID,
      render: Surface,
    })
  );
}

function translateFallback(
  locale: keyof typeof QUICK_CHAT_RESOURCES,
  key: 'title' | 'unavailable'
): string {
  return QUICK_CHAT_RESOURCES[locale][key];
}

export function deactivate(): void {
  drainDisposers();
}

export default { activate, deactivate };
