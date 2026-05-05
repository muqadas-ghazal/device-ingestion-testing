// Purpose: Decode WebSocket messages that may be plain JSON or FCAF-framed binary data.
const {
  createTcpFrameDecoder,
  hasTcpMagicHeader
} = require("../tcp/tcpFrameCodec");
const {
  parseJsonBuffer,
  parseJsonMessage
} = require("./jsonPayload");

// Purpose: Convert one WebSocket message into zero or more parsed watch packets.
function decodeWebSocketMessage(rawMessage, options = {}) {
  const buffer = Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(rawMessage);

  if (hasTcpMagicHeader(buffer)) {
    const decoder = createTcpFrameDecoder({ maxJsonBytes: options.maxJsonBytes });
    const decoded = decoder.push(buffer);
    return decoded.frames.map(parseJsonBuffer).filter(Boolean);
  }

  const message = parseJsonMessage(buffer);
  return message ? [message] : [];
}

module.exports = { decodeWebSocketMessage };
