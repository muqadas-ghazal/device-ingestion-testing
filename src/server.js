require("dotenv").config({ quiet: true });

const http = require("http");
const net = require("net");
const express = require("express");
const { WebSocket, WebSocketServer } = require("ws");
const {
  hasDatabaseConfig,
  checkDatabaseConnection,
  closeDatabaseConnection
} = require("./db");

const HTTP_PORT = Number(process.env.PORT || 3000);
const TCP_PORT = Number(process.env.TCP_PORT || 3001);
const WS_PATH = process.env.WS_PATH || "/watch";
const TCP_MAGIC = 0xfcaf;
const TCP_HEADER_BYTES = 4;
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 1024 * 1024);

const app = express();

// These events are the health upload command names described in the watch protocol.
// For now we only log them, but keeping this list explicit makes it easy to add
// persistence later without accidentally storing unrelated device commands.
const HEALTH_EVENT_TYPES = new Set([
  "upHeartRate",
  "upBP",
  "upBO",
  "upBodyTemperature",
  "upBS",
  "upBF",
  "upUA",
  "upECG",
  "upHRV",
  "upPPG",
  "upRR",
  "upBatch"
]);

// Motion/activity packets can also contain health-adjacent data, for example
// heart rate arrays inside an exercise record. They are logged separately.
const ACTIVITY_EVENT_TYPES = new Set([
  "upTodayActivity",
  "upRun",
  "upWalk",
  "upRide",
  "upFree"
]);

const SYSTEM_EVENT_TYPES = new Set(["login", "heartbeat"]);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "health-watch-direct-ingestion",
    websocket: WS_PATH,
    tcpPort: TCP_PORT,
    message: `Use ws://HOST:${HTTP_PORT}${WS_PATH} for WebSocket or HOST:${TCP_PORT} for TCP`
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/db", async (_req, res) => {
  if (!hasDatabaseConfig()) {
    res.status(503).json({ ok: false, database: "not_configured" });
    return;
  }

  try {
    await checkDatabaseConnection();
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    console.error("[db] health check failed", error);
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });
const tcpServer = net.createServer(handleTcpConnection);

wss.on("connection", (socket, request) => {
  const remoteAddress = request.socket.remoteAddress;
  console.log(`[ws] device connected from ${remoteAddress}`);

  socket.on("message", (rawMessage) => {
    const packets = decodeWebSocketMessage(rawMessage);

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

  socket.on("close", (code, reason) => {
    console.log(`[ws] device disconnected code=${code} reason=${reason.toString() || "-"}`);
  });

  socket.on("error", (error) => {
    console.error("[ws] socket error", error);
  });
});

start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function handleTcpConnection(socket) {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  const decoder = createTcpFrameDecoder();

  console.log(`[tcp] device connected from ${remote}`);

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

  socket.on("close", () => {
    console.log(`[tcp] device disconnected from ${remote}`);
  });

  socket.on("error", (error) => {
    console.error(`[tcp] socket error from ${remote}`, error);
  });
}

function parseJsonMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function decodeWebSocketMessage(rawMessage) {
  const buffer = Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(rawMessage);

  // Some gateways may forward the TCP binary frame over WebSocket. Supporting
  // both formats lets us test with either plain JSON or FCAF-framed binary data.
  if (buffer.length >= TCP_HEADER_BYTES && buffer.readUInt16BE(0) === TCP_MAGIC) {
    const decoder = createTcpFrameDecoder();
    const decoded = decoder.push(buffer);
    return decoded.frames.map(parseJsonBuffer).filter(Boolean);
  }

  const message = parseJsonMessage(buffer);
  return message ? [message] : [];
}

function createTcpFrameDecoder() {
  let pending = Buffer.alloc(0);

  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      const frames = [];
      const warnings = [];

      while (pending.length >= TCP_HEADER_BYTES) {
        const magicIndex = findTcpMagicIndex(pending);

        if (magicIndex === -1) {
          warnings.push(`discarded ${pending.length} byte(s) without FCAF header`);
          pending = Buffer.alloc(0);
          break;
        }

        if (magicIndex > 0) {
          warnings.push(`discarded ${magicIndex} byte(s) before FCAF header`);
          pending = pending.subarray(magicIndex);
        }

        if (pending.length < TCP_HEADER_BYTES) {
          break;
        }

        const jsonLength = pending.readUInt16BE(2);

        if (jsonLength <= 0 || jsonLength > MAX_JSON_BYTES) {
          warnings.push(`invalid frame length ${jsonLength}; dropping header`);
          pending = pending.subarray(2);
          continue;
        }

        const packetLength = TCP_HEADER_BYTES + jsonLength;

        if (pending.length < packetLength) {
          break;
        }

        frames.push(pending.subarray(TCP_HEADER_BYTES, packetLength));
        pending = pending.subarray(packetLength);
      }

      return { frames, warnings };
    }
  };
}

function findTcpMagicIndex(buffer) {
  for (let index = 0; index <= buffer.length - 2; index += 1) {
    if (buffer[index] === 0xfc && buffer[index + 1] === 0xaf) {
      return index;
    }
  }

  return -1;
}

function normalizeWatchMessage(message) {
  const nestedData = isPlainObject(message.data) ? message.data : {};

  // The protocol examples show both a common wrapper and direct payload fields.
  // This merge lets us accept either:
  // 1. { type, ident, ref, imei, data: { ... } }
  // 2. { type, imei, deviceModel, date, timestamp }
  return {
    ...nestedData,
    ...message,
    type: message.type || nestedData.type,
    imei: message.imei || nestedData.imei,
    deviceModel: message.deviceModel || nestedData.deviceModel,
    timestamp: message.timestamp || nestedData.timestamp
  };
}

function handleWatchPayload(message, transport) {
  const normalized = normalizeWatchMessage(message);
  const eventType = normalized.type;
  const receivedAt = new Date().toISOString();
  const category = getEventCategory(eventType);

  console.log(`[${receivedAt}] [${transport}] [${category}:${eventType || "missing-type"}]`);
  console.dir(normalized, { depth: null });

  return normalized;
}

function getEventCategory(eventType) {
  if (SYSTEM_EVENT_TYPES.has(eventType)) {
    return "system";
  }

  if (HEALTH_EVENT_TYPES.has(eventType)) {
    return "health";
  }

  if (ACTIVITY_EVENT_TYPES.has(eventType)) {
    return "activity";
  }

  return "unhandled";
}

function sendWsAck(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(buildAckPayload(message)));
}

function buildAckPayload(message) {
  const now = Date.now();
  const ackType = message.type || "unknown";

  // The document says replies should keep the same ident so the device can match
  // an upload with its server acknowledgement. ref=s:reply marks server reply.
  return {
    type: ackType,
    ident: message.ident,
    ref: "s:reply",
    imei: message.imei,
    data: {
      type: ackType,
      imei: message.imei,
      timestamp: now,
      status: "success"
    },
    extend: null,
    timestamp: now
  };
}

function sendWsError(socket, reason) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(buildErrorPayload(reason)));
}

function buildErrorPayload(reason) {
  return {
    type: "error",
    ref: "s:reply",
    data: { status: "failed", reason },
    timestamp: Date.now()
  };
}

function encodeTcpFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");

  if (json.length > 0xffff) {
    throw new Error(`TCP response JSON too large: ${json.length} bytes`);
  }

  const header = Buffer.alloc(TCP_HEADER_BYTES);
  header.writeUInt16BE(TCP_MAGIC, 0);
  header.writeUInt16BE(json.length, 2);
  return Buffer.concat([header, json]);
}

function logInvalidPayload(transport, rawMessage) {
  console.warn(
    `[${new Date().toISOString()}] [${transport}] invalid payload`,
    Buffer.isBuffer(rawMessage) ? rawMessage.toString("hex") : String(rawMessage)
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function start() {
  await initializeDatabase();

  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
    console.log(`WebSocket endpoint listening on ws://0.0.0.0:${HTTP_PORT}${WS_PATH}`);
  });

  tcpServer.listen(TCP_PORT, "0.0.0.0", () => {
    console.log(`TCP endpoint listening on 0.0.0.0:${TCP_PORT}`);
  });
}

async function initializeDatabase() {
  if (!hasDatabaseConfig()) {
    console.warn("[db] Azure SQL env vars are incomplete; database connection disabled.");
    return;
  }

  try {
    await checkDatabaseConnection();
    console.log("[db] Azure SQL connection ready");
  } catch (error) {
    console.error("[db] Azure SQL connection failed", error.message);
  }
}

async function shutdown() {
  console.log("Shutting down ingestion server...");
  wss.close();
  tcpServer.close();
  server.close(async () => {
    try {
      await closeDatabaseConnection();
    } catch (error) {
      console.error("[db] failed to close connection", error);
    } finally {
      process.exit(0);
    }
  });
}
