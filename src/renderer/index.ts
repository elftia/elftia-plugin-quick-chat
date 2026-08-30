import type {
  AgentUiTheme,
  HostThemeSnapshot,
  QuickChatWindowActivationContext,
  QuickChatWindowHost,
  QuickChatWindowModule,
} from '@elftia/plugin-types';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { QUICK_CHAT_NAMESPACE, QUICK_CHAT_RESOURCES, resolveLocale } from './localization';
import { QuickChatApplication, type ThemeStore } from './surface';

interface WindowRuntime {
  readonly disposed: () => boolean;
  dispose(): void;
}

function assertHost(host: unknown): asserts host is QuickChatWindowHost {
  if (!host || typeof host !== 'object') throw new TypeError('Quick Chat Host is required');
  const value = host as Partial<QuickChatWindowHost>;
  if (typeof value.version !== 'string' || !value.compat || typeof value.compat !== 'object') {
    throw new TypeError('Quick Chat Host version contract is invalid');
  }
  if (!value.i18n || typeof value.i18n.registerNamespace !== 'function') {
    throw new TypeError('Quick Chat Host i18n contract is invalid');
  }
  if (
    !value.theme ||
    typeof value.theme.getSnapshot !== 'function' ||
    typeof value.theme.subscribe !== 'function'
  ) {
    throw new TypeError('Quick Chat Host theme contract is invalid');
  }
  if (!value.localChannel || typeof value.localChannel.attach !== 'function') {
    throw new TypeError('Quick Chat Host Local Channel contract is invalid');
  }
  if (!value.close || typeof value.close.request !== 'function') {
    throw new TypeError('Quick Chat Host close contract is invalid');
  }
}

function assertRoot(root: unknown): asserts root is HTMLElement {
  if (
    !root ||
    typeof root !== 'object' ||
    !('nodeType' in root) ||
    root.nodeType !== 1 ||
    !('replaceChildren' in root) ||
    typeof root.replaceChildren !== 'function'
  ) {
    throw new TypeError('Quick Chat activation requires an HTMLElement root');
  }
}

function createThemeStore(
  theme: AgentUiTheme,
  isDisposed: () => boolean
): { readonly store: ThemeStore; readonly dispose: () => void } {
  let snapshot: HostThemeSnapshot = theme.getSnapshot();
  const listeners = new Set<() => void>();
  const unsubscribe = theme.subscribe((next) => {
    if (isDisposed()) return;
    snapshot = next;
    for (const listener of listeners) listener();
  });
  return {
    store: Object.freeze({
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) {
        if (isDisposed()) return () => undefined;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    dispose() {
      listeners.clear();
      unsubscribe();
    },
  };
}

function activateWindow(hostValue: QuickChatWindowHost, rootValue: HTMLElement): WindowRuntime {
  assertHost(hostValue);
  assertRoot(rootValue);

  let disposed = false;
  let reactRoot: Root | null = null;
  let unregisterLocale: (() => void) | null = null;
  let disposeTheme: (() => void) | null = null;
  const isDisposed = () => disposed;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    globalThis.removeEventListener('pagehide', dispose);

    const mountedRoot = reactRoot;
    reactRoot = null;
    try {
      mountedRoot?.unmount();
    } finally {
      try {
        disposeTheme?.();
      } finally {
        disposeTheme = null;
        try {
          unregisterLocale?.();
        } finally {
          unregisterLocale = null;
          rootValue.replaceChildren();
        }
      }
    }
  };

  try {
    rootValue.replaceChildren();
    unregisterLocale = hostValue.i18n.registerNamespace(QUICK_CHAT_NAMESPACE, QUICK_CHAT_RESOURCES);
    const theme = createThemeStore(hostValue.theme, isDisposed);
    disposeTheme = theme.dispose;
    reactRoot = createRoot(rootValue);
    reactRoot.render(
      React.createElement(QuickChatApplication, {
        localChannel: hostValue.localChannel,
        close: hostValue.close,
        themeStore: theme.store,
        locale: resolveLocale(typeof navigator === 'undefined' ? 'en' : navigator.language),
        isDisposed,
      })
    );
    globalThis.addEventListener('pagehide', dispose);
  } catch (error) {
    dispose();
    throw error;
  }

  return Object.freeze({ disposed: isDisposed, dispose });
}

const quickChatWindowModule = Object.freeze({
  activate(host: QuickChatWindowHost, { root }: QuickChatWindowActivationContext) {
    const runtime = activateWindow(host, root);
    return () => runtime.dispose();
  },
}) satisfies QuickChatWindowModule;

export default quickChatWindowModule;
