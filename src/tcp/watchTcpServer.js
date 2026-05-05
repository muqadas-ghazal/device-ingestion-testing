// Purpose: Accept TCP watch connections and bridge framed packets into protocol handling.
const net = require("net");
const {
  createTcpFrameDecoder,
  encodeTcpFrame
} = require("./tcpFrameCodec");
const { parseJsonBuffer } = require("../protocols/jsonPayload");
const { handleWatchPayload } = require("../protocols/watchPayload");
const { buildAckPayload, buildErrorPayload } = require("../protocols/watchAck");

// Purpose: Create the TCP server used by direct watch/device connections.
function createWatchTcpServer(options = {}) {
  // Purpose: Delegate each accepted socket to the per-connection handler.
  return net.createServer((socket) => handleTcpConnection(socket, options));
}

// Purpose: Decode frames from one TCP socket, ACK valid packets, and reject invalid JSON.
function handleTcpConnection(socket, options) {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  const decoder = createTcpFrameDecoder({ maxJsonBytes: options.maxJsonBytes });

  console.log(`[tcp] device connected from ${remote}`);

  // Purpose: Decode incoming TCP bytes and respond to each completed frame.
  socket.on("data", (chunk) => {
    const decoded = decoder.push(chunk);

    for (const frame of decoded.frames) {
      const message = parseJsonBuffer(frame);

      if (!message) {
        console.warn(`[${new Date().toISOString()}] [tcp] invalid JSON frame from ${remote}`);
        socket.write(encodeTcpFrame(buildErrorPayload("invalid_json")));
        continue;
      }

      const normalized = handleWatchPayload(message, "tcp");
      socket.write(encodeTcpFrame(buildAckPayload(normalized)));
    }

    for (const warning of decoded.warnings) {
      console.warn(`[${new Date().toISOString()}] [tcp] ${remote} ${warning}`);
    }
  });

  // Purpose: Log normal TCP disconnects.
  socket.on("close", () => {
    console.log(`[tcp] device disconnected from ${remote}`);
  });

  // Purpose: Log socket-level TCP errors.
  socket.on("error", (error) => {
    console.error(`[tcp] socket error from ${remote}`, error);
  });
}

module.exports = { createWatchTcpServer };
