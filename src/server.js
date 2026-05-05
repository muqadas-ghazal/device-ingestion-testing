// Purpose: Bootstrap the HTTP API, watch WebSocket server, TCP ingestion server, and DB lifecycle.
require("dotenv").config({ quiet: true });

const http = require("http");
const express = require("express");
const {
  hasDatabaseConfig,
  checkDatabaseConnection,
  closeDatabaseConnection
} = require("./db");
const { createHealthRouter } = require("./routes/health.routes");
const { createDigimedDevicesRouter } = require("./routes/digimedDevices.routes");
const { attachWatchWebSocketServer } = require("./websocket/watchSocketServer");
const { createWatchTcpServer } = require("./tcp/watchTcpServer");

const HTTP_PORT = Number(process.env.PORT || 3000);
const TCP_PORT = Number(process.env.TCP_PORT || 3001);
const WS_PATH = process.env.WS_PATH || "/watch";
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 1024 * 1024);

const app = express();

app.use(express.json({ limit: MAX_JSON_BYTES }));

// Purpose: Expose basic service metadata for manual checks.
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "health-watch-direct-ingestion",
    websocket: WS_PATH,
    tcpPort: TCP_PORT,
    message: `Use ws://HOST:${HTTP_PORT}${WS_PATH} for WebSocket or HOST:${TCP_PORT} for TCP`
  });
});

app.use("/health", createHealthRouter());
app.use("/api/digimed-devices", createDigimedDevicesRouter());

const server = http.createServer(app);
const wss = attachWatchWebSocketServer({
  server,
  path: WS_PATH,
  maxJsonBytes: MAX_JSON_BYTES
});
const tcpServer = createWatchTcpServer({ maxJsonBytes: MAX_JSON_BYTES });

start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Purpose: Initialize dependencies and start HTTP/WebSocket and TCP listeners.
async function start() {
  await initializeDatabase();

  // Purpose: Start HTTP and WebSocket traffic on the configured host/port.
  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
    console.log(`WebSocket endpoint listening on ws://0.0.0.0:${HTTP_PORT}${WS_PATH}`);
  });

  // Purpose: Start direct TCP watch ingestion on the configured host/port.
  tcpServer.listen(TCP_PORT, "0.0.0.0", () => {
    console.log(`TCP endpoint listening on 0.0.0.0:${TCP_PORT}`);
  });
}

// Purpose: Verify database connectivity at startup without blocking the server from listening forever.
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

// Purpose: Close socket servers and database connections before process exit.
async function shutdown() {
  console.log("Shutting down ingestion server...");
  wss.close();
  tcpServer.close();
  // Purpose: Close the HTTP server, then release DB resources before exiting.
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
