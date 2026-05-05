// Purpose: Attach a WebSocket ingestion endpoint for watch/device messages.
const { WebSocketServer } = require("ws");
const { handleWatchPayload } = require("../protocols/watchPayload");
const { logInvalidPayload } = require("../protocols/jsonPayload");
const { sendWsAck, sendWsError } = require("../protocols/watchAck");
const { decodeWebSocketMessage } = require("../protocols/watchWebSocketDecoder");

// Purpose: Bind WebSocket connection/message handlers to an existing HTTP server.
function attachWatchWebSocketServer(options) {
  const wss = new WebSocketServer({
    server: options.server,
    path: options.path
  });

  // Purpose: Handle one connected WebSocket device session.
  wss.on("connection", (socket, request) => {
    const remoteAddress = request.socket.remoteAddress;
    console.log(`[ws] device connected from ${remoteAddress}`);

    // Purpose: Decode each WebSocket message and ACK every valid packet.
    socket.on("message", (rawMessage) => {
      const packets = decodeWebSocketMessage(rawMessage, {
        maxJsonBytes: options.maxJsonBytes
      });

      if (!packets.length) {
        logInvalidPayload("ws", rawMessage);
        sendWsError(socket, "invalid_payload");
        return;
      }

      for (const packet of packets) {
        const normalized = handleWatchPayload(packet, "ws");
        sendWsAck(socket, normalized);
      }
    });

    // Purpose: Log normal WebSocket disconnects with protocol details.
    socket.on("close", (code, reason) => {
      console.log(`[ws] device disconnected code=${code} reason=${reason.toString() || "-"}`);
    });

    // Purpose: Log socket-level WebSocket errors.
    socket.on("error", (error) => {
      console.error("[ws] socket error", error);
    });
  });

  return wss;
}

module.exports = { attachWatchWebSocketServer };
