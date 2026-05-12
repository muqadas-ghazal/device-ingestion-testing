// Purpose: Define health-check routes for service and database availability.
const express = require("express");
const {
  hasDatabaseConfig,
  checkDatabaseConnection
} = require("../db");

// Purpose: Create the router that exposes HTTP and DB health endpoints.
function createHealthRouter() {
  const router = express.Router();

  // Purpose: Report that the HTTP process is alive.
  router.get("/", (_req, res) => {
    res.json({ ok: true });
  });

  // Purpose: Report whether Azure SQL can currently be reached.
  router.get("/db", async (_req, res) => {
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

  return router;
}

module.exports = { createHealthRouter };
