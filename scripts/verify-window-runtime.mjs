import { JSDOM } from 'jsdom';
import { fireEvent } from '@testing-library/dom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://quick-chat.invalid/',
  pretendToBeVisual: true,
});
for (const key of [
  'Node',
  'Element',
  'HTMLElement',
  'HTMLTextAreaElement',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'navigator',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);

let scrollCalls = 0;
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value() {
    scrollCalls += 1;
  },
});

const delay = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay();
  }
  throw new Error(`built window runtime timed out: ${label}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createClient(snapshotState) {
  let listener;
  let detachCalls = 0;
  let stopCalls = 0;
  let unsubscribeCalls = 0;
  let markReadCalls = 0;
  let pendingSend;
  const sendRequests = [];
  const client = {
    send(request) {
      sendRequests.push(request);
      pendingSend = deferred();
      return pendingSend.promise;
    },
    async stop() {
      stopCalls += 1;
    },
    async getSnapshot() {
      return snapshotState.current;
    },
    subscribe(next) {
      listener = next;
      return () => {
        unsubscribeCalls += 1;
        listener = undefined;
      };
    },
    async markRead() {
      markReadCalls += 1;
    },
    async detach() {
      detachCalls += 1;
    },
  };
  return {
    client,
    emit: (event) => listener?.(event),
    listener: () => listener,
    pendingSend: () => pendingSend,
    sendRequests,
    detachCalls: () => detachCalls,
    stopCalls: () => stopCalls,
    unsubscribeCalls: () => unsubscribeCalls,
    markReadCalls: () => markReadCalls,
  };
}

const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)> \u0000<&>';
const snapshotState = {
  current: {
    endpointId: 'default',
    chatId: 'owner',
    status: 'idle',
    revision: 1,
    unreadCount: 0,
    messages: [
      {
        id: 'initial-assistant',
        role: 'assistant',
        content: hostile,
        createdAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
        clientMessageId: null,
      },
    ],
    hasOlderMessages: false,
  },
};
const fixture = createClient(snapshotState);
const attachArguments = [];
let closeCalls = 0;
let unregisterLocaleCalls = 0;
let unsubscribeThemeCalls = 0;
let themeListener;
let themeSnapshot = { resolvedMode: 'light', isDarkMode: false };
const host = {
  version: '1.58.0',
  compat: { builtAgainst: '1.58.0', requiredMajor: 1, requiredMinor: 58 },
  i18n: {
    registerNamespace(namespace, resources) {
      if (namespace !== 'quick-chat' || !resources.en || !resources['zh-CN']) {
        throw new Error('built runtime did not register its locale resources');
      }
      return () => {
        unregisterLocaleCalls += 1;
      };
    },
  },
  theme: {
    getSnapshot: () => themeSnapshot,
    subscribe(listener) {
      themeListener = listener;
      return () => {
        unsubscribeThemeCalls += 1;
        themeListener = undefined;
      };
    },
  },
  localChannel: {
    async attach(...args) {
      attachArguments.push(args);
      return fixture.client;
    },
  },
  close: {
    async request() {
      closeCalls += 1;
    },
  },
};

const imported = await import('../dist/quick-chat/renderer/index.mjs');
if (!imported.default || Object.keys(imported.default).join(',') !== 'activate') {
  throw new Error('built renderer default export is not the exact QuickChatWindowModule');
}
const root = dom.window.document.getElementById('root');
const dispose = imported.default.activate(host, { root });
if (typeof dispose !== 'function') throw new Error('built renderer did not return a disposer');

await waitFor(() => fixture.listener() && root.querySelector('textarea'), 'initial activation');
await waitFor(
  () => root.textContent.includes('<script>alert(1)</script>'),
  'initial snapshot render'
);
if (attachArguments.length !== 1 || attachArguments[0].length !== 0) {
  throw new Error(
    `built renderer supplied Local Channel identity: ${JSON.stringify(attachArguments)}`
  );
}
if (fixture.markReadCalls() !== 1) throw new Error('built renderer did not mark replay read');
if (root.querySelector('script') || root.querySelector('img')) {
  throw new Error('hostile transcript content created executable DOM');
}
if (
  !root.textContent.includes('<script>alert(1)</script>') ||
  !root.textContent.includes('<img src=x onerror=alert(2)>')
) {
  throw new Error('hostile transcript text was not rendered inertly');
}
const style = root.querySelector('[data-testid="quick-chat-styles"]')?.textContent ?? '';
for (const required of [
  '-webkit-app-region: drag',
  '-webkit-app-region: no-drag',
  ':focus-visible',
]) {
  if (!style.includes(required)) throw new Error(`built renderer styles omit ${required}`);
}
const input = root.querySelector('[data-testid="quick-chat-composer-input"]');
const send = root.querySelector('[data-testid="quick-chat-send"]');
const close = root.querySelector('[data-testid="quick-chat-close"]');
if (!(input instanceof dom.window.HTMLTextAreaElement) || !send || !close) {
  throw new Error('built renderer does not own complete composer/chrome controls');
}
await waitFor(() => dom.window.document.activeElement === input, 'composer autofocus');

fireEvent.click(close);
await waitFor(() => closeCalls === 1, 'close intent');
if (fixture.stopCalls() !== 0) throw new Error('close intent stopped the active conversation');

fireEvent.input(input, { target: { value: 'hello from built runtime' } });
fireEvent.click(send);
fireEvent.click(send);
await waitFor(() => fixture.sendRequests.length === 1, 'single-flight send');
const request = fixture.sendRequests[0];
if (!request?.clientMessageId || request.text !== 'hello from built runtime') {
  throw new Error('built renderer did not submit the logical client message');
}
fixture.pendingSend().resolve({
  accepted: true,
  duplicate: false,
  message: {
    id: 'accepted-user',
    role: 'user',
    content: request.text,
    createdAt: '2026-01-01T00:00:01.000Z',
    revision: 2,
    clientMessageId: request.clientMessageId,
  },
});
await waitFor(() => root.textContent.includes('hello from built runtime'), 'accepted send');

fixture.emit({
  type: 'stream',
  revision: 3,
  stream: { type: 'text', delta: 'streamed reply' },
});
await waitFor(() => root.textContent.includes('streamed reply'), 'stream projection');
if (scrollCalls === 0) throw new Error('built renderer did not own transcript-tail scrolling');

snapshotState.current = {
  endpointId: 'default',
  chatId: 'owner',
  status: 'completed',
  revision: 5,
  unreadCount: 1,
  messages: [
    {
      id: 'replayed-assistant',
      role: 'assistant',
      content: 'background completion replayed',
      createdAt: '2026-01-01T00:00:02.000Z',
      revision: 5,
      clientMessageId: null,
    },
  ],
  hasOlderMessages: false,
};
fixture.emit({ type: 'resnapshot-required', code: 'RESNAPSHOT_REQUIRED' });
await waitFor(
  () => root.textContent.includes('background completion replayed'),
  'resnapshot replay'
);

themeSnapshot = { resolvedMode: 'dark', isDarkMode: true };
themeListener?.(themeSnapshot);
await waitFor(() => root.querySelector('[data-theme="dark"]'), 'dark theme projection');

dispose();
dispose();
globalThis.dispatchEvent(new dom.window.Event('pagehide'));
await waitFor(() => fixture.detachCalls() === 1, 'idempotent detach');
if (
  fixture.unsubscribeCalls() !== 1 ||
  fixture.stopCalls() !== 0 ||
  unregisterLocaleCalls !== 1 ||
  unsubscribeThemeCalls !== 1 ||
  root.childNodes.length !== 0
) {
  throw new Error(
    `built renderer cleanup drift: ${JSON.stringify({
      detach: fixture.detachCalls(),
      unsubscribe: fixture.unsubscribeCalls(),
      stop: fixture.stopCalls(),
      unregisterLocaleCalls,
      unsubscribeThemeCalls,
      rootChildren: root.childNodes.length,
    })}`
  );
}
fixture.emit({ type: 'status', revision: 6, status: 'processing' });
await delay();
if (root.childNodes.length !== 0) throw new Error('disposed built renderer revived its root');

const deferredAttach = deferred();
const lateSnapshot = { current: snapshotState.current };
const lateFixture = createClient(lateSnapshot);
let lateAttachCalls = 0;
const lateRoot = dom.window.document.createElement('div');
dom.window.document.body.append(lateRoot);
const lateHost = {
  ...host,
  i18n: { registerNamespace: () => () => undefined },
  theme: {
    getSnapshot: () => themeSnapshot,
    subscribe: () => () => undefined,
  },
  localChannel: {
    attach() {
      lateAttachCalls += 1;
      return deferredAttach.promise;
    },
  },
};
const disposeLate = imported.default.activate(lateHost, { root: lateRoot });
await waitFor(() => lateAttachCalls === 1, 'late attachment start');
disposeLate();
deferredAttach.resolve(lateFixture.client);
await waitFor(() => lateFixture.detachCalls() === 1, 'late attachment detach');
if (lateFixture.listener() || lateRoot.childNodes.length !== 0 || lateFixture.stopCalls() !== 0) {
  throw new Error('late attachment revived or widened disposed runtime state');
}

console.log(
  JSON.stringify({
    consumerGate: 'dedicated-window-v1',
    defaultExport: Object.keys(imported.default),
    attachArguments: attachArguments[0].length,
    sendCalls: fixture.sendRequests.length,
    closeCalls,
    scrollCalls,
    detachCalls: fixture.detachCalls(),
    lateDetachCalls: lateFixture.detachCalls(),
    stopCalls: fixture.stopCalls(),
    result: 'passed',
  })
);
