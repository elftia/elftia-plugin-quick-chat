/* elftia-plugin-quick-chat@0.1.0 | Host API 1.57.0 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/index.ts
var index_exports = {};
__export(index_exports, {
  QUICK_CHAT_PROVIDER_DESCRIPTOR: () => QUICK_CHAT_PROVIDER_DESCRIPTOR,
  activate: () => activate,
  createQuickChatEndpoint: () => createQuickChatEndpoint,
  deactivate: () => deactivate,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/shared/constants.ts
var CAPABILITY_ID = "elftia.quick-chat";
var CAPABILITY_VERSION = "1.0.0";
var CAPABILITY_OPERATION = "surface.request";
var SURFACE_INTENT_SCHEMA_ID = "elftia.quick-chat.surface-intent.v1";
var SURFACE_STATE_SCHEMA_ID = "elftia.quick-chat.surface-state.v1";
var MAX_DRAFT_UTF8_BYTES = 32 * 1024;
var MAX_STREAM_UTF8_BYTES = 64 * 1024;
var MAX_STREAM_SERIALIZED_UTF8_BYTES = 64 * 1024;
var MAX_ACTIVITY_FIELD_SERIALIZED_UTF8_BYTES = 2 * 1024;
var MAX_ACTIVITY_ITEM_UTF8_BYTES = 2 * 1024;
var MAX_ACTIVITY_ITEM_SERIALIZED_UTF8_BYTES = 4 * 1024;
var MAX_ACTIVITY_SERIALIZED_UTF8_BYTES = 24 * 1024;
var MAX_TRANSCRIPT_SERIALIZED_UTF8_BYTES = 224 * 1024;
var MAX_REMOTE_DOM_UTF8_BYTES = 512 * 1024;

// src/shared/surface-contract.ts
var SURFACE_OPERATIONS = [
  "open",
  "toggle",
  "focus",
  "close"
];
var PLACEMENT_INTENTS = [
  "near-active-pet",
  "near-cursor",
  "primary-bottom-right"
];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function parseSurfaceIntent(value) {
  if (!isRecord(value) || !exactKeys(value, ["operation", "placement"])) {
    throw new TypeError("Quick Chat surface intent must contain only operation and placement");
  }
  if (!SURFACE_OPERATIONS.includes(value.operation)) {
    throw new TypeError("Quick Chat surface operation is invalid");
  }
  if (value.placement !== void 0 && !PLACEMENT_INTENTS.includes(value.placement)) {
    throw new TypeError("Quick Chat placement intent is invalid");
  }
  return value.placement === void 0 ? { operation: value.operation } : {
    operation: value.operation,
    placement: value.placement
  };
}
function parseSurfaceState(value) {
  if (!isRecord(value) || !exactKeys(value, ["state"])) {
    throw new TypeError("Quick Chat surface state must contain only state");
  }
  if (value.state !== "visible" && value.state !== "closed") {
    throw new TypeError("Quick Chat surface state is invalid");
  }
  return { state: value.state };
}

// src/main/provider.ts
var QUICK_CHAT_PROVIDER_DESCRIPTOR = Object.freeze({
  id: CAPABILITY_ID,
  version: CAPABILITY_VERSION,
  target: "main",
  cardinality: "single",
  operations: Object.freeze([
    Object.freeze({
      name: CAPABILITY_OPERATION,
      mutability: "write",
      // The payload selects open/toggle/focus/close. Conservatively mark the
      // single transport operation non-idempotent because toggle is not.
      idempotency: "non-idempotent",
      inputSchemaId: SURFACE_INTENT_SCHEMA_ID,
      outputSchemaId: SURFACE_STATE_SCHEMA_ID
    })
  ])
});
function createQuickChatEndpoint(surface) {
  return Object.freeze({
    async invoke(_context, operation, payload) {
      if (operation !== CAPABILITY_OPERATION) {
        throw new TypeError(`Unsupported Quick Chat capability operation: ${operation}`);
      }
      const intent = parseSurfaceIntent(payload);
      const result = await surface.request(intent);
      return parseSurfaceState(result);
    }
  });
}
var unregisterProvider;
function disposeProvider() {
  const unregister = unregisterProvider;
  unregisterProvider = void 0;
  unregister?.();
}
function activate(host) {
  disposeProvider();
  const capabilities = host.capabilities;
  const surface = host.services.quickChatSurface;
  if (!capabilities || !surface) return;
  unregisterProvider = capabilities.provide(
    QUICK_CHAT_PROVIDER_DESCRIPTOR,
    createQuickChatEndpoint(surface)
  );
}
function deactivate() {
  disposeProvider();
}

// src/main/index.ts
var index_default = { activate, deactivate };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  QUICK_CHAT_PROVIDER_DESCRIPTOR,
  activate,
  createQuickChatEndpoint,
  deactivate
});
