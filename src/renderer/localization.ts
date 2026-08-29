export const QUICK_CHAT_NAMESPACE = 'quick-chat' as const;

export const QUICK_CHAT_RESOURCES = Object.freeze({
  en: {
    title: 'Quick Chat',
    loading: 'Loading conversation…',
    empty: 'Start a conversation with Elfi.',
    older: 'Earlier messages are not shown in this compact view.',
    processing: 'Elfi is responding…',
    idle: 'Ready',
    completed: 'Response complete',
    interrupted: 'Response stopped',
    suspended: 'Quick Chat is temporarily suspended.',
    unavailable: 'Quick Chat is unavailable.',
    error: 'The conversation could not be refreshed.',
    draftBlank: 'Enter a message first.',
    draftTooLarge: 'The message is larger than 32 KiB.',
    uncertain: 'Delivery is uncertain. Retry to reuse the same message id.',
    composer: 'Message composer',
    placeholder: 'Message Elfi',
    send: 'Send message',
    stop: 'Stop response',
    retry: 'Retry',
    transcript: 'Conversation transcript',
    user: 'You',
    assistant: 'Elfi',
    stream: 'Live response',
    omitted: 'Some large transcript content is omitted from this compact view.',
  },
  'zh-CN': {
    title: '快捷对话',
    loading: '正在加载对话…',
    empty: '开始和 Elfi 对话吧。',
    older: '精简窗口未显示更早的消息。',
    processing: 'Elfi 正在回复…',
    idle: '已就绪',
    completed: '回复完成',
    interrupted: '回复已停止',
    suspended: '快捷对话暂时停用。',
    unavailable: '快捷对话当前不可用。',
    error: '无法刷新对话。',
    draftBlank: '请先输入消息。',
    draftTooLarge: '消息不能超过 32 KiB。',
    uncertain: '发送结果不确定，重试会复用同一个消息 ID。',
    composer: '消息编辑区',
    placeholder: '给 Elfi 发消息',
    send: '发送消息',
    stop: '停止回复',
    retry: '重试',
    transcript: '对话记录',
    user: '你',
    assistant: 'Elfi',
    stream: '实时回复',
    omitted: '部分过长内容未在精简窗口中显示。',
  },
  ja: {
    title: 'クイックチャット',
    loading: '会話を読み込んでいます…',
    empty: 'Elfi と会話を始めましょう。',
    older: 'このコンパクト表示では以前のメッセージを省略しています。',
    processing: 'Elfi が応答しています…',
    idle: '準備完了',
    completed: '応答が完了しました',
    interrupted: '応答を停止しました',
    suspended: 'クイックチャットは一時停止中です。',
    unavailable: 'クイックチャットを利用できません。',
    error: '会話を更新できませんでした。',
    draftBlank: 'メッセージを入力してください。',
    draftTooLarge: 'メッセージは 32 KiB 以下にしてください。',
    uncertain: '送信結果が不明です。再試行すると同じメッセージ ID を使用します。',
    composer: 'メッセージ入力',
    placeholder: 'Elfi にメッセージ',
    send: 'メッセージを送信',
    stop: '応答を停止',
    retry: '再試行',
    transcript: '会話履歴',
    user: 'あなた',
    assistant: 'Elfi',
    stream: 'ライブ応答',
    omitted: '長い会話内容の一部をコンパクト表示から省略しています。',
  },
});

export type QuickChatLocale = keyof typeof QUICK_CHAT_RESOURCES;
export type QuickChatCopyKey = keyof (typeof QUICK_CHAT_RESOURCES)['en'];

export function resolveLocale(input: string | null | undefined): QuickChatLocale {
  const normalized = input?.toLowerCase() ?? '';
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('ja')) return 'ja';
  return 'en';
}

export function translate(locale: string | null | undefined, key: QuickChatCopyKey): string {
  const resolved = resolveLocale(locale);
  return QUICK_CHAT_RESOURCES[resolved][key];
}
