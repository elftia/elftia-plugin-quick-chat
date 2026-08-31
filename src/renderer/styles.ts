export const QUICK_CHAT_STYLES = `
.quick-chat-window {
  --surface-0: 50 37% 97%;
  --surface-1: 48 31% 94%;
  --surface-2: 47 25% 89%;
  --surface-3: 46 22% 85%;
  --border: 44 19% 81%;
  --foreground: 60 3% 8%;
  --muted-foreground: 48 3% 36%;
  --primary: 15 56% 52%;
  --primary-foreground: 210 40% 98%;
  --destructive: 0 56% 45%;
  --destructive-foreground: 210 40% 98%;
  color-scheme: light;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-height: 100%;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 16px;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-0));
  box-shadow: 0 20px 60px rgb(38 30 24 / 0.2);
  font-family: "Inter Variable", Inter, system-ui, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.55;
}

.quick-chat-window[data-theme="dark"] {
  --surface-0: 60 3% 8%;
  --surface-1: 30 6% 12%;
  --surface-2: 36 6% 16%;
  --surface-3: 34 7% 21%;
  --border: 40 7% 24%;
  --foreground: 47 31% 94%;
  --muted-foreground: 49 7% 67%;
  --primary: 15 56% 52%;
  --primary-foreground: 210 40% 98%;
  --destructive: 3 58% 62%;
  --destructive-foreground: 210 40% 98%;
  color-scheme: dark;
  border-color: hsl(var(--border));
  box-shadow: 0 22px 64px rgb(0 0 0 / 0.38);
}

.quick-chat-window,
.quick-chat-window * {
  box-sizing: border-box;
}

.quick-chat-chrome {
  -webkit-app-region: drag;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 10px 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.quick-chat-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.quick-chat-brand-mark {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  font-size: 14px;
  font-weight: 600;
}

.quick-chat-identity-copy {
  min-width: 0;
}

.quick-chat-identity-copy h1 {
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.quick-chat-subtitle {
  min-height: 12px;
  margin: 1px 0 0;
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-chat-no-drag,
.quick-chat-window button,
.quick-chat-window textarea {
  -webkit-app-region: no-drag;
}

.quick-chat-close {
  display: grid;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: hsl(var(--muted-foreground));
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}

.quick-chat-close svg {
  width: 14px;
  height: 14px;
}

.quick-chat-close:hover {
  color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.1);
}

.quick-chat-transcript {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  padding: 8px 0;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  user-select: text;
}

.quick-chat-empty {
  display: flex;
  flex: 1 0 auto;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 32px 24px;
  text-align: center;
}

.quick-chat-empty-icon {
  display: grid;
  width: 56px;
  height: 56px;
  margin-bottom: 16px;
  place-items: center;
  border-radius: 16px;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
}

.quick-chat-empty-icon svg {
  width: 28px;
  height: 28px;
}

.quick-chat-empty h2 {
  max-width: 280px;
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.quick-chat-message-row {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 16px;
}

.quick-chat-message-user {
  flex-direction: row-reverse;
}

.quick-chat-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  margin-top: 1px;
  place-items: center;
  border-radius: 999px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--surface-1) / 0.8);
}

.quick-chat-message-assistant .quick-chat-avatar {
  color: hsl(var(--primary));
}

.quick-chat-avatar svg {
  width: 14px;
  height: 14px;
}

.quick-chat-message-bubble {
  width: fit-content;
  max-width: 80%;
  padding: 8px 12px;
  overflow-wrap: anywhere;
  border-radius: 12px;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-1) / 0.8);
  font-size: 14px;
  line-height: 1.55;
}

.quick-chat-message-user .quick-chat-message-bubble {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
}

.quick-chat-message-bubble p {
  margin: 0;
  white-space: pre-wrap;
}

.quick-chat-activity {
  margin-top: 6px !important;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.quick-chat-stream-cursor {
  display: inline-block;
  width: 6px;
  height: 16px;
  margin-left: 2px;
  border-radius: 2px;
  vertical-align: text-bottom;
  background: hsl(var(--primary) / 0.7);
  animation: quick-chat-pulse 1.1s ease-in-out infinite;
}

.quick-chat-notice {
  margin: 8px 16px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  text-align: center;
}

.quick-chat-composer {
  flex: 0 0 auto;
  padding: 12px;
  border-top: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--surface-0));
}

.quick-chat-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.quick-chat-composer textarea {
  display: block;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  max-height: 120px;
  resize: none;
  overflow-y: auto;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  outline: none;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-2));
  font: inherit;
  font-size: 14px;
  line-height: 18px;
  field-sizing: content;
}

.quick-chat-composer textarea::placeholder {
  color: hsl(var(--muted-foreground));
}

.quick-chat-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.quick-chat-action {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.quick-chat-action svg {
  width: 16px;
  height: 16px;
}

.quick-chat-send {
  color: hsl(var(--primary-foreground));
  background: hsl(var(--primary));
}

.quick-chat-send:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.9);
}

.quick-chat-stop {
  color: hsl(var(--destructive-foreground));
  background: hsl(var(--destructive));
}

.quick-chat-stop:hover {
  background: hsl(var(--destructive) / 0.9);
}

.quick-chat-retry {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid hsl(var(--border) / 0.7);
  border-radius: 8px;
  color: hsl(var(--foreground));
  background: hsl(var(--surface-1));
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.quick-chat-retry svg {
  width: 14px;
  height: 14px;
}

.quick-chat-action:disabled,
.quick-chat-composer textarea:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.quick-chat-window button:focus-visible,
.quick-chat-window textarea:focus-visible,
.quick-chat-transcript:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px hsl(var(--primary));
}

.quick-chat-composer-error {
  margin: 8px 2px 0;
  color: hsl(var(--destructive));
  font-size: 11px;
}

@keyframes quick-chat-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .quick-chat-stream-cursor { animation: none; }
  .quick-chat-window button { transition: none; }
}

@media (max-width: 350px), (max-height: 430px) {
  .quick-chat-chrome { padding: 8px 12px; }
  .quick-chat-message-row { padding-inline: 12px; }
  .quick-chat-composer { padding: 9px; }
  .quick-chat-empty { min-height: 180px; padding-block: 20px; }
}
`;
