export const QUICK_CHAT_STYLES = `
.quick-chat-window {
  --quick-chat-bg: #f5f2ff;
  --quick-chat-panel: rgba(255, 255, 255, 0.88);
  --quick-chat-panel-strong: #ffffff;
  --quick-chat-text: #241d38;
  --quick-chat-muted: #6e6680;
  --quick-chat-accent: #7558d8;
  --quick-chat-accent-strong: #5a3fc0;
  --quick-chat-border: rgba(74, 57, 119, 0.16);
  --quick-chat-shadow: 0 18px 48px rgba(48, 34, 89, 0.16);
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: 100%;
  height: 100vh;
  min-height: 100%;
  overflow: hidden;
  color: var(--quick-chat-text);
  background:
    radial-gradient(circle at 12% 2%, rgba(167, 137, 255, 0.22), transparent 38%),
    var(--quick-chat-bg);
  font-family: Inter, "Segoe UI", system-ui, sans-serif;
}

.quick-chat-window[data-theme="dark"] {
  --quick-chat-bg: #17131f;
  --quick-chat-panel: rgba(36, 29, 49, 0.9);
  --quick-chat-panel-strong: #2a2238;
  --quick-chat-text: #f2edff;
  --quick-chat-muted: #b7aec9;
  --quick-chat-accent: #a58af7;
  --quick-chat-accent-strong: #b9a4ff;
  --quick-chat-border: rgba(221, 207, 255, 0.14);
  --quick-chat-shadow: 0 20px 54px rgba(0, 0, 0, 0.34);
}

.quick-chat-window,
.quick-chat-window * {
  box-sizing: border-box;
}

.quick-chat-chrome {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: 10px 12px 8px 16px;
  border-bottom: 1px solid var(--quick-chat-border);
}

.quick-chat-chrome h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 680;
  letter-spacing: 0.01em;
}

.quick-chat-no-drag,
.quick-chat-window button,
.quick-chat-window textarea {
  -webkit-app-region: no-drag;
}

.quick-chat-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  color: var(--quick-chat-muted);
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.quick-chat-close:hover {
  color: var(--quick-chat-text);
  background: var(--quick-chat-panel);
}

.quick-chat-status {
  margin: 0;
  padding: 8px 16px;
  color: var(--quick-chat-muted);
  font-size: 12px;
}

.quick-chat-empty {
  align-self: center;
  margin: 0 20px;
  color: var(--quick-chat-muted);
  text-align: center;
}

.quick-chat-transcript {
  min-height: 0;
  overflow: auto;
  padding: 8px 14px 18px;
  overscroll-behavior: contain;
  user-select: text;
  scrollbar-gutter: stable;
}

.quick-chat-message,
.quick-chat-stream {
  width: fit-content;
  max-width: 88%;
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--quick-chat-border);
  border-radius: 14px 14px 14px 5px;
  background: var(--quick-chat-panel);
  box-shadow: 0 4px 18px rgba(44, 34, 73, 0.06);
}

.quick-chat-message-user {
  margin-left: auto;
  border-color: transparent;
  border-radius: 14px 14px 5px 14px;
  color: #ffffff;
  background: var(--quick-chat-accent);
}

.quick-chat-message h2,
.quick-chat-stream h2 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.75;
}

.quick-chat-message p,
.quick-chat-stream p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 16px;
  line-height: 1.5;
}

.quick-chat-stream {
  border-style: dashed;
}

.quick-chat-notice {
  margin: 10px 4px;
  color: var(--quick-chat-muted);
  font-size: 11px;
  text-align: center;
}

.quick-chat-composer {
  margin: 0 10px 10px;
  padding: 10px;
  border: 1px solid var(--quick-chat-border);
  border-radius: 16px;
  background: var(--quick-chat-panel-strong);
  box-shadow: var(--quick-chat-shadow);
}

.quick-chat-composer textarea {
  display: block;
  width: 100%;
  min-height: 60px;
  max-height: 150px;
  resize: vertical;
  padding: 4px 5px;
  border: 0;
  outline: none;
  color: var(--quick-chat-text);
  background: transparent;
  font: inherit;
  line-height: 1.45;
}

.quick-chat-composer textarea::placeholder {
  color: var(--quick-chat-muted);
}

.quick-chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 8px;
}

.quick-chat-actions button {
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid var(--quick-chat-border);
  border-radius: 10px;
  color: var(--quick-chat-text);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.quick-chat-actions button:first-child {
  border-color: transparent;
  color: #ffffff;
  background: var(--quick-chat-accent);
}

.quick-chat-actions button:first-child:hover:not(:disabled) {
  background: var(--quick-chat-accent-strong);
}

.quick-chat-actions button:disabled,
.quick-chat-composer textarea:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.quick-chat-window button:focus-visible,
.quick-chat-window textarea:focus-visible,
.quick-chat-transcript:focus-visible {
  outline: 2px solid var(--quick-chat-accent);
  outline-offset: 2px;
}

.quick-chat-composer-error {
  margin: 8px 2px 0;
  color: #c73f55;
  font-size: 11px;
}

@media (max-width: 350px), (max-height: 430px) {
  .quick-chat-chrome {
    min-height: 42px;
    padding-block: 6px;
  }

  .quick-chat-status {
    padding-block: 5px;
  }

  .quick-chat-transcript {
    padding-inline: 10px;
  }

  .quick-chat-composer {
    margin: 0 7px 7px;
    border-radius: 13px;
  }
}
`;
