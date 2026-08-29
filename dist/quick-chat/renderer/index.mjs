/* elftia-plugin-quick-chat@0.1.0 | Host API 1.57.0 */

// src/shared/constants.ts
var SURFACE_ID = "default";
var ENDPOINT_ID = "default";
var CHAT_ID = "owner";
var MAX_DRAFT_UTF8_BYTES = 32 * 1024;
var MAX_STREAM_UTF8_BYTES = 64 * 1024;
var MAX_STREAM_SERIALIZED_UTF8_BYTES = 64 * 1024;
var MAX_ACTIVITY_ITEMS = 16;
var MAX_ACTIVITY_FIELD_UTF8_BYTES = 1024;
var MAX_ACTIVITY_FIELD_SERIALIZED_UTF8_BYTES = 2 * 1024;
var MAX_ACTIVITY_ITEM_UTF8_BYTES = 2 * 1024;
var MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES = 4 * 1024;
var MAX_ACTIVITY_SERIALIZED_UTF8_BYTES = 24 * 1024;
var MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES = 224 * 1024;
var MAX_MESSAGES = 200;
var MAX_RESNAPSHOT_FAILURES = 3;
var MAX_REMOTE_DOM_UTF8_BYTES = 512 * 1024;

// src/renderer/localization.ts
var QUICK_CHAT_NAMESPACE = "quick-chat";
var QUICK_CHAT_RESOURCES = Object.freeze({
  en: {
    title: "Quick Chat",
    loading: "Loading conversation…",
    empty: "Start a conversation with Elfi.",
    older: "Earlier messages are not shown in this compact view.",
    processing: "Elfi is responding…",
    idle: "Ready",
    completed: "Response complete",
    interrupted: "Response stopped",
    suspended: "Quick Chat is temporarily suspended.",
    unavailable: "Quick Chat is unavailable.",
    error: "The conversation could not be refreshed.",
    draftBlank: "Enter a message first.",
    draftTooLarge: "The message is larger than 32 KiB.",
    uncertain: "Delivery is uncertain. Retry to reuse the same message id.",
    composer: "Message composer",
    placeholder: "Message Elfi",
    send: "Send message",
    stop: "Stop response",
    retry: "Retry",
    transcript: "Conversation transcript",
    user: "You",
    assistant: "Elfi",
    stream: "Live response",
    omitted: "Some large transcript content is omitted from this compact view."
  },
  "zh-CN": {
    title: "快捷对话",
    loading: "正在加载对话…",
    empty: "开始和 Elfi 对话吧。",
    older: "精简窗口未显示更早的消息。",
    processing: "Elfi 正在回复…",
    idle: "已就绪",
    completed: "回复完成",
    interrupted: "回复已停止",
    suspended: "快捷对话暂时停用。",
    unavailable: "快捷对话当前不可用。",
    error: "无法刷新对话。",
    draftBlank: "请先输入消息。",
    draftTooLarge: "消息不能超过 32 KiB。",
    uncertain: "发送结果不确定，重试会复用同一个消息 ID。",
    composer: "消息编辑区",
    placeholder: "给 Elfi 发消息",
    send: "发送消息",
    stop: "停止回复",
    retry: "重试",
    transcript: "对话记录",
    user: "你",
    assistant: "Elfi",
    stream: "实时回复",
    omitted: "部分过长内容未在精简窗口中显示。"
  },
  ja: {
    title: "クイックチャット",
    loading: "会話を読み込んでいます…",
    empty: "Elfi と会話を始めましょう。",
    older: "このコンパクト表示では以前のメッセージを省略しています。",
    processing: "Elfi が応答しています…",
    idle: "準備完了",
    completed: "応答が完了しました",
    interrupted: "応答を停止しました",
    suspended: "クイックチャットは一時停止中です。",
    unavailable: "クイックチャットを利用できません。",
    error: "会話を更新できませんでした。",
    draftBlank: "メッセージを入力してください。",
    draftTooLarge: "メッセージは 32 KiB 以下にしてください。",
    uncertain: "送信結果が不明です。再試行すると同じメッセージ ID を使用します。",
    composer: "メッセージ入力",
    placeholder: "Elfi にメッセージ",
    send: "メッセージを送信",
    stop: "応答を停止",
    retry: "再試行",
    transcript: "会話履歴",
    user: "あなた",
    assistant: "Elfi",
    stream: "ライブ応答",
    omitted: "長い会話内容の一部をコンパクト表示から省略しています。"
  }
});
function resolveLocale(input) {
  const normalized = input?.toLowerCase() ?? "";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("ja")) return "ja";
  return "en";
}
function translate(locale, key) {
  const resolved = resolveLocale(locale);
  return QUICK_CHAT_RESOURCES[resolved][key];
}

// src/renderer/conversation-state.ts
var INITIAL_CONVERSATION_STATE = Object.freeze({
  phase: "loading",
  status: "idle",
  revision: 0,
  unreadCount: 0,
  messages: Object.freeze([]),
  hasOlderMessages: false,
  streamText: "",
  activity: Object.freeze([]),
  needsSnapshot: false,
  requiredSnapshotRevision: null,
  resnapshotFailures: 0,
  error: null
});
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function utf8Bytes(value) {
  return encoder.encode(value).byteLength;
}
function takeUtf8Suffix(value, maximumBytes) {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  let start = bytes.byteLength - maximumBytes;
  while (start < bytes.byteLength) {
    const byte = bytes[start];
    if (byte === void 0 || (byte & 192) !== 128) break;
    start += 1;
  }
  return decoder.decode(bytes.slice(start));
}
function takeUtf8Prefix(value, maximumBytes) {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  let end = Math.max(0, maximumBytes);
  while (end > 0) {
    const byte = bytes[end];
    if (byte === void 0 || (byte & 192) !== 128) break;
    end -= 1;
  }
  return decoder.decode(bytes.slice(0, end));
}
function serializedUtf8Bytes(value) {
  return utf8Bytes(JSON.stringify(value));
}
function takeSerializedBounded(value, maximumRawBytes, maximumSerializedBytes, fromEnd) {
  const rawBounded = fromEnd ? takeUtf8Suffix(value, maximumRawBytes) : takeUtf8Prefix(value, maximumRawBytes);
  if (serializedUtf8Bytes(rawBounded) <= maximumSerializedBytes) return rawBounded;
  const codePoints = Array.from(rawBounded);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = fromEnd ? codePoints.slice(codePoints.length - middle).join("") : codePoints.slice(0, middle).join("");
    if (serializedUtf8Bytes(candidate) <= maximumSerializedBytes) low = middle;
    else high = middle - 1;
  }
  return fromEnd ? codePoints.slice(codePoints.length - low).join("") : codePoints.slice(0, low).join("");
}
function takeProjectedTextPrefix(value, maximumRawBytes, maximumSerializedBytes) {
  return takeSerializedBounded(value, maximumRawBytes, maximumSerializedBytes, false);
}
function takeProjectedTextSuffix(value, maximumRawBytes, maximumSerializedBytes) {
  return takeSerializedBounded(value, maximumRawBytes, maximumSerializedBytes, true);
}
function canonicalIndex(messages, candidate) {
  const byHostId = messages.findIndex((message) => message.id === candidate.id);
  if (byHostId >= 0) return byHostId;
  if (!candidate.clientMessageId) return -1;
  return messages.findIndex(
    (message) => message.clientMessageId !== null && message.clientMessageId !== void 0 && message.clientMessageId === candidate.clientMessageId
  );
}
function reconcileMessage(messages, candidate, appendUnknown) {
  const index = canonicalIndex(messages, candidate);
  if (index < 0) {
    return appendUnknown ? [...messages, candidate].slice(-MAX_MESSAGES) : messages;
  }
  const current = messages[index];
  if (!current) return messages;
  if (candidate.revision < current.revision && candidate.id === current.id) return messages;
  const output = [...messages];
  output[index] = candidate;
  return output;
}
function isTerminal(status) {
  return status !== "processing";
}
function activityFor(stream) {
  const boundedField = (value) => takeProjectedTextPrefix(
    value,
    MAX_ACTIVITY_FIELD_UTF8_BYTES,
    MAX_ACTIVITY_FIELD_SERIALIZED_UTF8_BYTES
  );
  if (stream.type === "reasoning") {
    return {
      kind: "reasoning",
      text: takeProjectedTextPrefix(
        boundedField(stream.text),
        MAX_ACTIVITY_ITEM_UTF8_BYTES,
        MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES
      )
    };
  }
  if (stream.type === "tool") {
    const text = [stream.phase, stream.name, stream.status, stream.summary].filter((value) => typeof value === "string" && value.length > 0).map(boundedField).join(" · ");
    return {
      kind: "tool",
      text: takeProjectedTextPrefix(
        text,
        MAX_ACTIVITY_ITEM_UTF8_BYTES,
        MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES
      )
    };
  }
  return null;
}
function appendActivity(activity, item) {
  const bounded = [...activity, item].slice(-MAX_ACTIVITY_ITEMS);
  while (bounded.length > 0 && serializedUtf8Bytes(bounded) > MAX_ACTIVITY_SERIALIZED_UTF8_BYTES) {
    bounded.shift();
  }
  return bounded;
}
function applyFreshEvent(state, event) {
  if (event.type === "message") {
    const clearsTransient = event.message.role === "assistant";
    return {
      ...state,
      phase: "ready",
      revision: event.revision,
      messages: reconcileMessage(state.messages, event.message, true),
      streamText: clearsTransient ? "" : state.streamText,
      activity: clearsTransient ? [] : state.activity,
      error: null
    };
  }
  if (event.type === "status") {
    return {
      ...state,
      phase: "ready",
      revision: event.revision,
      status: event.status,
      streamText: isTerminal(event.status) ? "" : state.streamText,
      activity: isTerminal(event.status) ? [] : state.activity,
      error: null
    };
  }
  if (event.type === "unread") {
    return { ...state, revision: event.revision, unreadCount: event.unreadCount };
  }
  if (event.type === "stream") {
    const item = activityFor(event.stream);
    return {
      ...state,
      phase: "ready",
      revision: event.revision,
      status: "processing",
      streamText: event.stream.type === "text" ? takeProjectedTextSuffix(
        state.streamText + event.stream.delta,
        MAX_STREAM_UTF8_BYTES,
        MAX_STREAM_SERIALIZED_UTF8_BYTES
      ) : state.streamText,
      activity: item ? appendActivity(state.activity, item) : state.activity
    };
  }
  return {
    ...state,
    phase: "error",
    revision: event.revision,
    error: { code: event.code, message: event.message, retryable: true }
  };
}
function conversationReducer(state, action) {
  if (action.type === "loading") return { ...state, phase: "loading", error: null };
  if (action.type === "clear-error") {
    return { ...state, phase: state.phase === "revoked" ? "revoked" : "ready", error: null };
  }
  if (action.type === "transport-error") {
    return {
      ...state,
      phase: "error",
      error: { code: action.code, message: action.message, retryable: action.retryable }
    };
  }
  if (action.type === "resnapshot-failed") {
    const failures = Math.min(state.resnapshotFailures + 1, MAX_RESNAPSHOT_FAILURES);
    return {
      ...state,
      phase: "error",
      resnapshotFailures: failures,
      needsSnapshot: true,
      error: {
        code: "SNAPSHOT_FAILED",
        message: action.message,
        retryable: failures < MAX_RESNAPSHOT_FAILURES
      }
    };
  }
  if (action.type === "snapshot") {
    const snapshot = action.snapshot;
    if (snapshot.endpointId !== ENDPOINT_ID) {
      return {
        ...state,
        phase: "error",
        error: {
          code: "SNAPSHOT_IDENTITY_MISMATCH",
          message: "The Host returned a snapshot for another endpoint.",
          retryable: false
        }
      };
    }
    return {
      phase: "ready",
      status: snapshot.status,
      revision: snapshot.revision,
      unreadCount: snapshot.unreadCount,
      messages: snapshot.messages.slice(-MAX_MESSAGES),
      hasOlderMessages: snapshot.hasOlderMessages || snapshot.messages.length > MAX_MESSAGES,
      streamText: "",
      activity: [],
      needsSnapshot: state.requiredSnapshotRevision !== null && snapshot.revision < state.requiredSnapshotRevision,
      requiredSnapshotRevision: state.requiredSnapshotRevision !== null && snapshot.revision < state.requiredSnapshotRevision ? state.requiredSnapshotRevision : null,
      resnapshotFailures: 0,
      error: null
    };
  }
  if (action.type === "send-result") {
    return {
      ...state,
      phase: "ready",
      revision: Math.max(state.revision, action.result.message.revision),
      messages: reconcileMessage(state.messages, action.result.message, true),
      error: null
    };
  }
  const event = action.event;
  if (event.type === "revoked") {
    return {
      ...state,
      phase: "revoked",
      needsSnapshot: false,
      requiredSnapshotRevision: null,
      streamText: "",
      activity: [],
      error: { code: event.code, message: "Quick Chat is unavailable.", retryable: true }
    };
  }
  if (event.type === "resnapshot-required") {
    return { ...state, needsSnapshot: true };
  }
  if (state.needsSnapshot || event.revision > state.revision + 1) {
    return {
      ...state,
      needsSnapshot: true,
      requiredSnapshotRevision: Math.max(state.requiredSnapshotRevision ?? 0, event.revision)
    };
  }
  if (event.revision <= state.revision) {
    if (event.type !== "message") return state;
    const messages = reconcileMessage(state.messages, event.message, false);
    return messages === state.messages ? state : { ...state, messages };
  }
  return applyFreshEvent(state, event);
}

// src/renderer/submission.ts
function isNormalizedSubmitIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value;
  if (intent.key !== "Enter") return false;
  for (const key of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing"]) {
    if (intent[key] !== void 0 && typeof intent[key] !== "boolean") return false;
  }
  return !intent.shiftKey && !intent.ctrlKey && !intent.altKey && !intent.metaKey && !intent.isComposing;
}
function defaultIdFactory() {
  return globalThis.crypto.randomUUID();
}
var LogicalSubmission = class {
  constructor(client, onAccepted, idFactory = defaultIdFactory) {
    this.client = client;
    this.onAccepted = onAccepted;
    this.idFactory = idFactory;
  }
  pending = false;
  uncertain = null;
  isPending() {
    return this.pending;
  }
  canRetry(text) {
    return this.uncertain?.text === text;
  }
  async submit(text) {
    if (this.pending) return { state: "pending" };
    if (text.trim().length === 0) return { state: "invalid", message: "blank" };
    if (utf8Bytes(text) > MAX_DRAFT_UTF8_BYTES) {
      return { state: "invalid", message: "too-large" };
    }
    const logical = this.uncertain?.text === text ? this.uncertain : { text, clientMessageId: this.idFactory() };
    this.pending = true;
    try {
      const result = await this.client.send(logical);
      if (!result.accepted && !result.duplicate) {
        throw new Error("Host did not accept or identify a duplicate message");
      }
      this.uncertain = null;
      this.onAccepted(result);
      return { state: result.duplicate ? "duplicate" : "accepted", result };
    } catch (error) {
      this.uncertain = logical;
      return {
        state: "uncertain",
        message: error instanceof Error ? error.message : "send failed"
      };
    } finally {
      this.pending = false;
    }
  }
};

// src/renderer/conversation-session.ts
var ConversationSession = class {
  constructor(channels, onState, idFactory) {
    this.channels = channels;
    this.onState = onState;
    this.idFactory = idFactory;
  }
  state = INITIAL_CONVERSATION_STATE;
  client = null;
  unsubscribe = null;
  submission = null;
  initialReady = false;
  bufferedEvents = [];
  refreshPromise = null;
  refreshClient = null;
  refreshEpoch = 0;
  refreshQueued = false;
  lifecyclePromise = null;
  lifecycleEpoch = 0;
  disposed = false;
  getState() {
    return this.state;
  }
  start() {
    if (!this.disposed && this.client) return Promise.resolve();
    this.disposed = false;
    return this.beginLifecycle(false);
  }
  reattach() {
    if (this.disposed) return Promise.resolve();
    return this.beginLifecycle(true);
  }
  async refresh() {
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
          if (snapshot.chatId !== CHAT_ID) throw new Error("Host returned another chat snapshot");
          this.dispatchCurrent(epoch, client, { type: "snapshot", snapshot });
          await this.markRead(epoch, client);
        } catch {
          if (!this.isCurrent(epoch, client)) return;
          this.dispatchCurrent(epoch, client, {
            type: "resnapshot-failed",
            message: "Snapshot refresh failed."
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
  async submit(text) {
    if (this.state.phase === "revoked" || this.state.status === "suspended") {
      return { state: "invalid", message: "unavailable" };
    }
    const client = this.client;
    const submission = this.submission;
    const epoch = this.lifecycleEpoch;
    if (!client || !submission) return { state: "invalid", message: "not-attached" };
    const outcome = await submission.submit(text);
    if (outcome.state === "uncertain" && this.isCurrent(epoch, client, submission)) {
      this.dispatchCurrent(epoch, client, {
        type: "transport-error",
        code: "SEND_UNCERTAIN",
        message: "Message acceptance is uncertain.",
        retryable: true
      });
    }
    return outcome;
  }
  isSubmitPending() {
    return this.submission?.isPending() ?? false;
  }
  isAttached() {
    return !this.disposed && this.client !== null;
  }
  canRetrySubmission(text) {
    return this.submission?.canRetry(text) ?? false;
  }
  async stop() {
    const client = this.client;
    const epoch = this.lifecycleEpoch;
    if (!client || this.state.status !== "processing" || this.state.phase === "revoked") return;
    try {
      await client.stop();
    } catch {
      if (!this.isCurrent(epoch, client)) return;
      this.dispatchCurrent(epoch, client, {
        type: "transport-error",
        code: "STOP_FAILED",
        message: "The response could not be stopped.",
        retryable: true
      });
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleEpoch += 1;
    await this.releaseClient();
  }
  dispatch(action) {
    if (this.disposed) return;
    this.state = conversationReducer(this.state, action);
    this.onState(this.state);
    if (this.state.needsSnapshot) void this.refresh();
  }
  dispatchCurrent(epoch, client, action) {
    if (!this.isCurrent(epoch, client)) return;
    this.dispatch(action);
  }
  shouldContinueRefresh(epoch, client) {
    return this.isCurrent(epoch, client) && (this.refreshQueued || this.state.needsSnapshot);
  }
  isCurrent(epoch, client, submission) {
    return !this.disposed && this.lifecycleEpoch === epoch && this.client === client && (submission === void 0 || this.submission === submission);
  }
  handleEvent(epoch, client, event) {
    if (!this.isCurrent(epoch, client)) return;
    if (!this.initialReady) {
      this.bufferedEvents.push(event);
      return;
    }
    this.dispatch({ type: "event", event });
  }
  beginLifecycle(releaseCurrent) {
    if (this.lifecyclePromise) return this.lifecyclePromise;
    const epoch = this.lifecycleEpoch + 1;
    this.lifecycleEpoch = epoch;
    const lifecyclePromise = this.performLifecycle(epoch, releaseCurrent).finally(() => {
      if (this.lifecyclePromise === lifecyclePromise) this.lifecyclePromise = null;
    });
    this.lifecyclePromise = lifecyclePromise;
    return lifecyclePromise;
  }
  async performLifecycle(epoch, releaseCurrent) {
    if (releaseCurrent) await this.releaseClient();
    if (this.disposed || this.lifecycleEpoch !== epoch) return;
    if (releaseCurrent || this.state.phase !== "loading") this.dispatch({ type: "loading" });
    await this.connect(epoch);
  }
  async connect(epoch) {
    let attachedClient = null;
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
            this.dispatchCurrent(epoch, client, { type: "send-result", result });
          }
        },
        this.idFactory
      );
      this.submission = submission;
      const snapshot = await client.getSnapshot();
      if (!this.isCurrent(epoch, client)) return;
      if (snapshot.chatId !== CHAT_ID) throw new Error("Host returned another chat snapshot");
      this.dispatchCurrent(epoch, client, { type: "snapshot", snapshot });
      this.initialReady = true;
      const buffered = this.bufferedEvents;
      this.bufferedEvents = [];
      for (const event of buffered) {
        if (!this.isCurrent(epoch, client)) return;
        this.dispatchCurrent(epoch, client, { type: "event", event });
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
        type: "transport-error",
        code: "ATTACH_FAILED",
        message: "Quick Chat attachment failed.",
        retryable: true
      });
    }
  }
  async markRead(epoch, client) {
    if (!this.isCurrent(epoch, client)) return;
    try {
      await client.markRead();
    } catch {
      if (!this.isCurrent(epoch, client)) return;
      this.dispatchCurrent(epoch, client, {
        type: "transport-error",
        code: "MARK_READ_FAILED",
        message: "The conversation could not be marked as read.",
        retryable: true
      });
    }
  }
  async releaseClient() {
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
    }
    if (client) await this.detachClient(client);
  }
  async detachClient(client) {
    try {
      await client.detach();
    } catch {
    }
  }
};

// src/renderer/surface.ts
function selectRenderableMessages(messages) {
  const bounded = messages.slice(-MAX_MESSAGES);
  const selected = [];
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
        content: `${takeProjectedTextPrefix(message.content, remaining - 3, remaining - 3)}…`
      });
    }
    break;
  }
  return { messages: selected.reverse(), omitted };
}
function readEventValue(event) {
  if (!event || typeof event !== "object") return "";
  const target = event.target;
  if (!target || typeof target !== "object") return "";
  const value = target.value;
  return typeof value === "string" ? value : "";
}
function createQuickChatSurface(host, themeStore, locale) {
  const React = host.react.instance;
  const h = React.createElement;
  const Button = host.ui.Button;
  function QuickChatSurface() {
    const [state, setState] = React.useState(INITIAL_CONVERSATION_STATE);
    const [session, setSession] = React.useState(null);
    const [draft, setDraft] = React.useState("");
    const [pending, setPending] = React.useState(false);
    const [composerError, setComposerError] = React.useState(null);
    const draftRef = React.useRef("");
    const draftRevisionRef = React.useRef(0);
    const sendFlightRef = React.useRef(null);
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
    const unavailable = state.phase === "revoked" || state.status === "suspended";
    const canSend = !unavailable && !pending && state.phase !== "loading";
    const copy = (key) => translate(locale, key);
    const updateDraft = (value) => {
      draftRef.current = value;
      draftRevisionRef.current += 1;
      setDraft(value);
    };
    const send = () => {
      if (sendFlightRef.current) return sendFlightRef.current;
      if (!session || !canSend) return Promise.resolve();
      const submittedDraft = draftRef.current;
      const submittedRevision = draftRevisionRef.current;
      setPending(true);
      setComposerError(null);
      const flight = (async () => {
        const result = await session.submit(submittedDraft);
        if (result.state === "accepted" || result.state === "duplicate") {
          if (draftRevisionRef.current === submittedRevision && draftRef.current === submittedDraft) {
            draftRef.current = "";
            setDraft("");
          }
          return;
        }
        if (result.state === "invalid") {
          setComposerError(
            result.message === "too-large" ? copy("draftTooLarge") : copy("draftBlank")
          );
        } else if (result.state === "uncertain") {
          setComposerError(copy("uncertain"));
        }
      })().finally(() => {
        if (sendFlightRef.current !== flight) return;
        sendFlightRef.current = null;
        setPending(false);
      });
      sendFlightRef.current = flight;
      return flight;
    };
    const retry = async () => {
      if (!session) return;
      if (session.canRetrySubmission(draft)) await send();
      else if (state.phase === "revoked" || state.status === "suspended" || !session.isAttached())
        await session.reattach();
      else await session.refresh();
    };
    const statusKey = state.phase === "loading" ? "loading" : state.phase === "revoked" ? "unavailable" : state.phase === "error" || state.status === "error" ? "error" : state.status === "processing" ? "processing" : state.status === "suspended" ? "suspended" : state.status === "completed" ? "completed" : state.status === "interrupted" ? "interrupted" : "idle";
    const transcript = selectRenderableMessages(state.messages);
    const transcriptChildren = [];
    if (state.hasOlderMessages) {
      transcriptChildren.push(
        h("p", { key: "older", "data-testid": "quick-chat-older-history" }, copy("older"))
      );
    }
    if (transcript.omitted) {
      transcriptChildren.push(
        h("p", { key: "omitted", "data-testid": "quick-chat-budget-notice" }, copy("omitted"))
      );
    }
    for (const message of transcript.messages) {
      const label = message.role === "user" ? copy("user") : copy("assistant");
      transcriptChildren.push(
        h(
          "article",
          {
            key: message.id,
            "data-testid": `quick-chat-message-${message.role}`,
            "aria-label": label
          },
          h("h2", null, label),
          h("p", null, message.content)
        )
      );
    }
    if (state.streamText || state.activity.length > 0) {
      transcriptChildren.push(
        h(
          "section",
          { key: "stream", "data-testid": "quick-chat-stream", "aria-label": copy("stream") },
          h("h2", null, copy("stream")),
          state.streamText ? h("p", null, state.streamText) : null,
          ...state.activity.map(
            (item, index) => h("p", { key: `${item.kind}-${index}` }, item.text)
          )
        )
      );
    }
    transcriptChildren.push(
      h("span", { key: "tail", "data-testid": "quick-chat-transcript-tail", "aria-hidden": true })
    );
    return h(
      "main",
      { "data-testid": "quick-chat-root", "aria-label": copy("title") },
      h("h1", null, copy("title")),
      h(
        "p",
        {
          role: "status",
          "aria-live": "polite",
          "data-testid": "quick-chat-state"
        },
        copy(statusKey)
      ),
      state.messages.length === 0 && state.phase === "ready" && state.status === "idle" ? h("p", { "data-testid": "quick-chat-empty" }, copy("empty")) : null,
      h(
        "section",
        {
          role: "log",
          "aria-live": "polite",
          "aria-label": copy("transcript"),
          "data-testid": "quick-chat-transcript"
        },
        ...transcriptChildren
      ),
      h(
        "section",
        {
          role: "group",
          "aria-label": copy("composer"),
          "data-testid": "quick-chat-composer"
        },
        h("textarea", {
          value: draft,
          disabled: !canSend,
          placeholder: copy("placeholder"),
          "aria-label": copy("placeholder"),
          "aria-disabled": !canSend,
          "data-testid": "quick-chat-composer-input",
          onChange: (event) => updateDraft(readEventValue(event)),
          onKeyDown: (event) => {
            if (isNormalizedSubmitIntent(event)) void send();
          }
        }),
        h(
          Button,
          {
            disabled: !canSend,
            onClick: () => void send(),
            "aria-label": copy("send"),
            "data-testid": "quick-chat-send",
            variant: "default",
            size: "sm"
          },
          copy("send")
        ),
        state.status === "processing" && state.phase !== "revoked" ? h(
          Button,
          {
            onClick: () => void session?.stop(),
            "aria-label": copy("stop"),
            "data-testid": "quick-chat-stop",
            variant: "secondary",
            size: "sm"
          },
          copy("stop")
        ) : null,
        state.error?.retryable || state.status === "suspended" ? h(
          Button,
          {
            onClick: () => void retry(),
            "aria-label": copy("retry"),
            "data-testid": "quick-chat-retry",
            variant: "outline",
            size: "sm"
          },
          copy("retry")
        ) : null,
        composerError ? h(
          "p",
          { role: "status", "aria-live": "polite", "data-testid": "quick-chat-composer-error" },
          composerError
        ) : null
      )
    );
  }
  Object.defineProperty(QuickChatSurface, "name", { value: `QuickChatSurface_${SURFACE_ID}` });
  return QuickChatSurface;
}

// src/renderer/index.ts
var fallbackTheme = Object.freeze({
  resolvedMode: "light",
  isDarkMode: false
});
var disposers = [];
function drainDisposers() {
  const retained = disposers;
  disposers = [];
  for (const dispose of retained.reverse()) dispose();
}
function browserLocale() {
  return typeof navigator === "undefined" ? "en" : navigator.language;
}
function createThemeStore(host) {
  let snapshot = host.theme?.getSnapshot() ?? fallbackTheme;
  const listeners = /* @__PURE__ */ new Set();
  const unsubscribe = host.theme?.subscribe((next) => {
    snapshot = next;
    for (const listener of listeners) listener();
  });
  if (unsubscribe) disposers.push(unsubscribe);
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
function activate(host) {
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
    const Unavailable = () => React.createElement(
      "main",
      { "data-testid": "quick-chat-root", "aria-label": translateFallback(locale, "title") },
      React.createElement(
        "p",
        { role: "status", "data-testid": "quick-chat-state" },
        translateFallback(locale, "unavailable")
      )
    );
    disposers.push(
      quickChat.registerSurface({
        id: SURFACE_ID,
        render: Unavailable
      })
    );
    return;
  }
  const Surface = createQuickChatSurface({ localChannels, react, ui }, themeStore, locale);
  disposers.push(
    quickChat.registerSurface({
      id: SURFACE_ID,
      render: Surface
    })
  );
}
function translateFallback(locale, key) {
  return QUICK_CHAT_RESOURCES[locale][key];
}
function deactivate() {
  drainDisposers();
}
var index_default = { activate, deactivate };
export {
  activate,
  deactivate,
  index_default as default
};
