// Purpose: Accept TCP watch connections and bridge framed packets into protocol handling.
const net = require("net");
const {
  createTcpFrameDecoder,
  encodeTcpFrame
} = require("./tcpFrameCodec");
const { parseJsonBuffer } = require("../protocols/jsonPayload");
const { handleWatchPayload } = require("../protocols/watchPayload");
const { buildAckPayload, buildErrorPayload } = require("../protocols/watchAck");
const { buildLoginConfigurationCommands } = require("../protocols/watchCommands");

const PACKET_DEBUG = process.env.WATCH_PACKET_DEBUG === "1";

// Purpose: Create the TCP server used by direct watch/device connections.
function createWatchTcpServer(options = {}) {
  // Purpose: Delegate each accepted socket to the per-connection handler.
  return net.createServer((socket) => handleTcpConnection(socket, options));
}

// Purpose: Decode frames from one TCP socket, ACK valid packets, and reject invalid JSON.
function handleTcpConnection(socket, options) {
  const remote = getSocketRemote(socket);
  const decoder = createTcpFrameDecoder({ maxJsonBytes: options.maxJsonBytes });
  const configuredImeis = new Set();

  console.log(`[tcp] device connected from ${remote}`);

  // Purpose: Decode incoming TCP bytes and respond to each completed frame.
  socket.on("data", (chunk) => {
    console.log(`[${new Date().toISOString()}] [tcp] ${remote} received ${chunk.length} byte(s)`);
    logPacketDebug(remote, "raw_chunk", chunk);

    const decoded = decoder.push(chunk);

    for (const frame of decoded.frames) {
      logPacketDebug(remote, "decoded_frame", frame);
      const message = parseJsonBuffer(frame);

      if (!message) {
        console.warn(
          `[${new Date().toISOString()}] [tcp] ${remote} invalid JSON frame ` +
            `bytes=${frame.length} hexPreview=${frame.toString("hex", 0, Math.min(frame.length, 96))}`
        );
        socket.write(encodeTcpFrame(buildErrorPayload("invalid_json")));
        continue;
      }

      logPacketDebug(remote, "parsed_json", frame, message);
      const normalized = handleWatchPayload(message, "tcp");
      socket.write(encodeTcpFrame(buildAckPayload(normalized)));
      sendLoginConfigurationCommands(socket, remote, normalized, options, configuredImeis);
    }

    for (const warning of decoded.warnings) {
      logDecodeWarning(remote, warning);
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

// Purpose: Push measurement/location settings once after a device login is acknowledged.
function sendLoginConfigurationCommands(socket, remote, message, options, configuredImeis) {
  if (!isLoginMessage(message) || !message.imei || configuredImeis.has(message.imei)) {
    return;
  }

  configuredImeis.add(message.imei);

  const commands = buildLoginConfigurationCommands(message.imei, options);

  for (const command of commands) {
    console.log(
      `[${new Date().toISOString()}] [tcp] ${remote} sending command ` +
        `type=${command.type} imei=${command.imei} ident=${command.ident}`
    );
    socket.write(encodeTcpFrame(command));
  }
}

// Purpose: Support both the documented login type and common vendor naming variants.
function isLoginMessage(message) {
  const type = String(message.type || "").trim().toLowerCase();
  return type === "login" || type === "uplogin";
}

// Purpose: Print raw packet details only when investigating real watch traffic.
function logPacketDebug(remote, label, buffer, message = null) {
  if (!PACKET_DEBUG) {
    return;
  }

  const previewBytes = 512;
  const hexPreview = buffer.toString("hex", 0, Math.min(buffer.length, previewBytes));
  const asciiPreview = toPrintableAscii(buffer.subarray(0, previewBytes));
  const parts = [
    `[${new Date().toISOString()}] [packet-debug] ${remote}`,
    `label=${label}`,
    `bytes=${buffer.length}`,
    `hex=${hexPreview}`,
    `ascii="${asciiPreview}"`
  ];

  if (message && typeof message === "object") {
    parts.push(`keys=${Object.keys(message).join(",") || "-"}`);
    parts.push(`type=${message.type || message.data?.type || "-"}`);
    parts.push(`imei=${message.imei || message.data?.imei || "-"}`);
  }

  console.log(parts.join(" "));
}

// Purpose: Make binary packet previews readable without terminal control characters.
function toPrintableAscii(buffer) {
  return Array.from(buffer, (byte) => {
    if (byte >= 0x20 && byte <= 0x7e) {
      return String.fromCharCode(byte);
    }

    return ".";
  }).join("");
}

// Purpose: Return a stable remote identifier even when Node has already cleared socket fields.
function getSocketRemote(socket) {
  return `${socket.remoteAddress || "unknown"}:${socket.remotePort || "unknown"}`;
}

// Purpose: Print enough rejected-byte context to debug protocol or port-routing issues.
function logDecodeWarning(remote, warning) {
  const parts = [
    `[${new Date().toISOString()}] [tcp] ${remote}`,
    `decode_warning=${warning.reason}`,
    `discardedBytes=${warning.discardedBytes}`,
    `hint=${warning.hint}`
  ];

  if (warning.frameLength != null) {
    parts.push(`frameLength=${warning.frameLength}`);
  }

  if (warning.maxJsonBytes != null) {
    parts.push(`maxJsonBytes=${warning.maxJsonBytes}`);
  }

  parts.push(`hexPreview=${warning.hexPreview || "-"}`);
  parts.push(`asciiPreview="${warning.asciiPreview || "-"}"`);
  console.warn(parts.join(" "));
}

module.exports = { createWatchTcpServer };
