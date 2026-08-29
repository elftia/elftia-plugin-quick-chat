import { JSDOM } from 'jsdom';

const MAX_FRAME_BYTES = 512 * 1024;
const MAX_NODES = 4096;
const MAX_DEPTH = 64;
const SAFE_TAGS = new Set([
  'article',
  'button',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'img',
  'input',
  'label',
  'li',
  'main',
  'ol',
  'p',
  'section',
  'span',
  'textarea',
  'ul',
]);
const SAFE_ATTRIBUTES = new Set([
  'alt',
  'aria-checked',
  'aria-disabled',
  'aria-hidden',
  'aria-label',
  'aria-live',
  'checked',
  'data-testid',
  'disabled',
  'name',
  'placeholder',
  'role',
  'src',
  'tabindex',
  'title',
  'type',
  'value',
]);
const SAFE_EVENTS = new Set(['change', 'click', 'input', 'keydown', 'submit']);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://quick-chat.invalid/',
});
for (const key of [
  'Node',
  'Element',
  'HTMLElement',
  'HTMLTextAreaElement',
  'MutationObserver',
  'navigator',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ReactModule = await import('react');
const React = ReactModule.default;
const { act } = ReactModule;
const { createRoot } = await import('react-dom/client');
const { fireEvent } = await import('@testing-library/dom');

let registeredSurface;
let eventListener;
const hostile = `${'\u0000<&>"\\\n'.repeat(4096)}${'界'.repeat(4096)}`;
const messages = Array.from({ length: 200 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `${index}:${hostile}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  revision: index + 1,
  clientMessageId: index % 2 === 0 ? `client-${index}` : null,
}));
let snapshotMessages = messages;
let snapshotRevision = messages.length;
let sendCalls = 0;
let pendingSend;
const client = {
  send(request) {
    sendCalls += 1;
    return new Promise((resolve) => {
      pendingSend = { request, resolve };
    });
  },
  async stop() {},
  async getSnapshot() {
    return {
      endpointId: 'default',
      chatId: 'owner',
      status: 'idle',
      revision: snapshotRevision,
      unreadCount: 0,
      messages: snapshotMessages,
      hasOlderMessages: false,
    };
  },
  subscribe(listener) {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  },
  async markRead() {},
  async detach() {},
};
const Button = ({ children, ...props }) => React.createElement('button', props, children);
const host = {
  version: '1.57.0',
  compat: { state: 'compatible' },
  react: { instance: React, version: React.version },
  ui: { Button },
  i18n: { registerNamespace: () => () => {} },
  theme: {
    getSnapshot: () => ({ resolvedMode: 'light', isDarkMode: false }),
    subscribe: () => () => {},
  },
  quickChat: {
    registerSurface(definition) {
      registeredSurface = definition;
      return () => {
        registeredSurface = undefined;
      };
    },
  },
  localChannels: { attach: async () => client },
};

let nextNodeId = 0;
function serializeNode(node) {
  const id = `node-${++nextNodeId}`;
  if (node.nodeType === dom.window.Node.TEXT_NODE) {
    return { kind: 'text', id, text: node.textContent ?? '' };
  }
  if (!(node instanceof dom.window.Element)) return null;
  const children = Array.from(node.childNodes)
    .map(serializeNode)
    .filter((child) => child !== null);
  const testId = node.getAttribute('data-testid');
  if (node.tagName.toLowerCase() === 'button' && testId?.startsWith('quick-chat-')) {
    const props = {};
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name === 'variant' || attribute.name === 'size') continue;
      props[attribute.name] = attribute.value;
    }
    props.variant = node.getAttribute('variant') ?? 'default';
    return {
      kind: 'host',
      id,
      namespace: 'ui',
      name: 'Button',
      props,
      events: [],
      callbacks: { onClick: 'click' },
      children,
    };
  }
  const attributes = {};
  for (const attribute of Array.from(node.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  const events = node.tagName.toLowerCase() === 'textarea' ? ['change', 'keydown'] : [];
  return {
    kind: 'element',
    id,
    tag: node.tagName.toLowerCase(),
    attributes,
    events,
    children,
  };
}

function validateNode(node, depth, ids) {
  if (depth > MAX_DEPTH) throw new Error(`remote DOM depth exceeded: ${depth}`);
  if (ids.has(node.id)) throw new Error(`duplicate remote DOM node id: ${node.id}`);
  ids.add(node.id);
  if (node.kind === 'text') return { count: 1, maximumDepth: depth };
  if (node.kind === 'element') {
    if (!SAFE_TAGS.has(node.tag)) throw new Error(`unsafe remote tag: ${node.tag}`);
    for (const name of Object.keys(node.attributes)) {
      const lower = name.toLowerCase();
      if (!SAFE_ATTRIBUTES.has(lower) || lower.startsWith('on')) {
        throw new Error(`unsafe remote attribute: ${name}`);
      }
    }
  } else if (node.kind === 'host') {
    if (node.namespace !== 'ui' || node.name !== 'Button') {
      throw new Error(`unsafe remote Host component: ${node.namespace}.${node.name}`);
    }
    if (node.callbacks.onClick !== 'click') throw new Error('unsafe Button callback');
    for (const name of Object.keys(node.props)) {
      if (
        ['children', 'class', 'className', 'dangerouslySetInnerHTML', 'ref', 'style'].includes(name)
      ) {
        throw new Error(`unsafe remote Host prop: ${name}`);
      }
      if (/^on[A-Z]/.test(name)) throw new Error(`executable remote Host prop: ${name}`);
    }
  }
  for (const event of node.events) {
    if (!SAFE_EVENTS.has(event)) throw new Error(`unsafe remote event: ${event}`);
  }
  let count = 1;
  let maximumDepth = depth;
  for (const child of node.children) {
    const result = validateNode(child, depth + 1, ids);
    count += result.count;
    maximumDepth = Math.max(maximumDepth, result.maximumDepth);
  }
  return { count, maximumDepth };
}

function validateProjection(container, sequence, label) {
  nextNodeId = 0;
  const rootNode = container.firstChild ? serializeNode(container.firstChild) : null;
  const frame = {
    kind: sequence === 1 ? 'remote-dom-snapshot' : 'remote-dom-patch',
    surfaceId: 'default',
    sequence,
    ...(sequence === 1
      ? { root: rootNode }
      : { operations: [{ op: 'replace-root', root: rootNode }] }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
  if (bytes > MAX_FRAME_BYTES) {
    throw new Error(`${label} remote DOM frame exceeds 512 KiB: ${bytes}`);
  }
  const result = rootNode ? validateNode(rootNode, 0, new Set()) : { count: 0, maximumDepth: 0 };
  if (result.count > MAX_NODES) throw new Error(`${label} node limit exceeded: ${result.count}`);
  return { label, bytes, nodes: result.count, depth: result.maximumDepth };
}

const plugin = await import('../dist/quick-chat/renderer/index.mjs');
plugin.activate(host);
if (!registeredSurface) throw new Error('built renderer did not register Quick Chat surface');
const container = dom.window.document.getElementById('root');
const root = createRoot(container);
await act(async () => {
  root.render(React.createElement(registeredSurface.render));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
if (!eventListener) throw new Error('built renderer did not subscribe to Local Channel events');

const results = [validateProjection(container, 1, 'maximum transcript')];
const millionControlCharacters = '\u0000'.repeat(1024 * 1024);
await act(async () => {
  eventListener({
    type: 'stream',
    revision: 201,
    stream: { type: 'reasoning', text: millionControlCharacters },
  });
});
if (!container.querySelector('[data-testid="quick-chat-stream"]')) {
  throw new Error('reasoning-only activity is not visible');
}
results.push(validateProjection(container, 2, 'reasoning-only activity'));

await act(async () => {
  eventListener({
    type: 'stream',
    revision: 202,
    stream: {
      type: 'tool',
      phase: 'start',
      name: millionControlCharacters,
      status: 'running',
      summary: millionControlCharacters,
    },
  });
  eventListener({
    type: 'stream',
    revision: 203,
    stream: { type: 'text', delta: millionControlCharacters },
  });
});
results.push(validateProjection(container, 3, 'combined hostile stream'));

snapshotMessages = Array.from({ length: 200 }, (_, index) => ({
  id: `compact-${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `compact message ${index}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  revision: 204 + index,
  clientMessageId: index % 2 === 0 ? `compact-client-${index}` : null,
}));
snapshotRevision = 403;
await act(async () => {
  eventListener({ type: 'resnapshot-required', code: 'RESNAPSHOT_REQUIRED' });
  await new Promise((resolve) => setTimeout(resolve, 0));
});
results.push(validateProjection(container, 4, 'maximum node transcript'));

const input = container.querySelector('[data-testid="quick-chat-composer-input"]');
const sendButton = container.querySelector('[data-testid="quick-chat-send"]');
if (!(input instanceof dom.window.HTMLTextAreaElement) || !sendButton) {
  throw new Error('built renderer composer controls are unavailable');
}
await act(async () => {
  fireEvent.change(input, { target: { value: 'first' } });
  await Promise.resolve();
});
await act(async () => {
  fireEvent.click(sendButton);
  fireEvent.click(sendButton);
  await Promise.resolve();
});
if (sendCalls !== 1 || !input.disabled || !sendButton.disabled || !pendingSend) {
  throw new Error(
    `built renderer submission is not synchronous single-flight: ${JSON.stringify({
      sendCalls,
      inputDisabled: input.disabled,
      buttonDisabled: sendButton.disabled,
      hasPendingSend: Boolean(pendingSend),
      value: input.value,
    })}`
  );
}
await act(async () => {
  pendingSend.resolve({
    accepted: true,
    duplicate: false,
    message: {
      id: 'accepted-first',
      role: 'user',
      content: pendingSend.request.text,
      createdAt: '2026-01-01T00:00:00.000Z',
      revision: 404,
      clientMessageId: pendingSend.request.clientMessageId,
    },
  });
  await Promise.resolve();
});
if (input.disabled || sendButton.disabled || input.value !== '') {
  throw new Error('built renderer released submission ownership incorrectly');
}
await act(async () => {
  fireEvent.change(input, { target: { value: 'second' } });
  await Promise.resolve();
});
if (input.value !== 'second' || sendCalls !== 1) {
  throw new Error('an earlier completion erased or resent the newer draft');
}

await act(async () => root.unmount());
plugin.deactivate();
console.log(
  JSON.stringify({
    consumerGate: 'opaque-remote-dom-v1',
    results,
    submission: { calls: sendCalls, newerDraft: input.value },
  })
);
