// Purpose: Bootstrap the HTTP API, TCP watch ingestion server, and DB lifecycle.
require("dotenv").config({ quiet: true });

const http = require("http");
const express = require("express");
const swaggerUi = require("swagger-ui-express");
const {
  hasDatabaseConfig,
  checkDatabaseConnection,
  closeDatabaseConnection
} = require("./db");
const { createHealthRouter } = require("./routes/health.routes");
const { createDigimedDevicesRouter } = require("./routes/digimedDevices.routes");
const { createWatchTcpServer } = require("./tcp/watchTcpServer");
const { openApiDocument } = require("./docs/openapi");
const { initializeWatchRealtime } = require("./realtime/watchRealtime");

const HTTP_PORT = Number(process.env.PORT || 3000);
const TCP_PORT = Number(process.env.TCP_PORT || 3001);
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 1024 * 1024);
const WATCH_COMMAND_OPTIONS = {
  autoConfigureOnLogin: process.env.WATCH_AUTO_CONFIGURE_ON_LOGIN,
  healthIntervalMinutes: process.env.WATCH_HEALTH_INTERVAL_MINUTES,
  heartRateIntervalMinutes: process.env.WATCH_HEART_RATE_INTERVAL_MINUTES,
  bpIntervalMinutes: process.env.WATCH_BP_INTERVAL_MINUTES,
  boIntervalMinutes: process.env.WATCH_BO_INTERVAL_MINUTES,
  temperatureIntervalMinutes: process.env.WATCH_TEMPERATURE_INTERVAL_MINUTES,
  boFrequency: process.env.WATCH_BO_FREQUENCY,
  temperatureFrequency: process.env.WATCH_TEMPERATURE_FREQUENCY,
  includeLocation: process.env.WATCH_INCLUDE_LOCATION,
  locationIntervalSeconds: process.env.WATCH_LOCATION_INTERVAL_SECONDS
};

const app = express();

app.use(express.json({ limit: MAX_JSON_BYTES }));

// Purpose: Expose basic service metadata for manual checks.
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "health-watch-direct-ingestion",
    tcpPort: TCP_PORT,
    docs: "/api-docs",
    socketEvents: {
      subscribe: "watch:subscribe",
      vital: "watch:vital"
    },
    message: `Configure Wonlex devices to connect to HOST:${TCP_PORT} over raw TCP`
  });
});

app.use("/health", createHealthRouter());
app.use("/api/digimed-devices", createDigimedDevicesRouter());
app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

const server = http.createServer(app);
initializeWatchRealtime(server);
const tcpServer = createWatchTcpServer({
  maxJsonBytes: MAX_JSON_BYTES,
  ...WATCH_COMMAND_OPTIONS
});

start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Purpose: Initialize dependencies and start HTTP and TCP listeners.
async function start() {
  await initializeDatabase();

  // Purpose: Start HTTP API traffic on the configured host/port.
  server.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP server listening on http://0.0.0.0:${HTTP_PORT}`);
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
