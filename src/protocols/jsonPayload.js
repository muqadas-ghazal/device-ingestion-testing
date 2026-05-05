// Purpose: Provide safe JSON parsing and invalid-payload logging helpers.
// Purpose: Parse a raw WebSocket message as UTF-8 JSON.
function parseJsonMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

// Purpose: Parse a TCP frame body buffer as UTF-8 JSON.
function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

// Purpose: Log malformed payloads without throwing from transport handlers.
function logInvalidPayload(transport, rawMessage) {
  console.warn(
    `[${new Date().toISOString()}] [${transport}] invalid payload`,
    Buffer.isBuffer(rawMessage) ? rawMessage.toString("hex") : String(rawMessage)
  );
}

module.exports = {
  parseJsonMessage,
  parseJsonBuffer,
  logInvalidPayload
};
