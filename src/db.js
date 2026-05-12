// Purpose: Manage the shared Azure SQL connection pool for the ingestion server.
const sql = require("mssql");

let poolPromise = null;

// Purpose: Check whether all required Azure SQL environment variables are present.
function hasDatabaseConfig() {
  return Boolean(
    process.env.AZURE_SQL_SERVER &&
      process.env.AZURE_SQL_DATABASE &&
      process.env.AZURE_SQL_USER &&
      process.env.AZURE_SQL_PASSWORD
  );
}

// Purpose: Build the mssql connection configuration from environment variables.
function getDatabaseConfig() {
  return {
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    port: Number(process.env.AZURE_SQL_PORT || 1433),
    pool: {
      max: Number(process.env.AZURE_SQL_POOL_MAX || 10),
      min: Number(process.env.AZURE_SQL_POOL_MIN || 0),
      idleTimeoutMillis: Number(process.env.AZURE_SQL_IDLE_TIMEOUT_MS || 30000)
    },
    options: {
      encrypt: true,
      trustServerCertificate: process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE === "1"
    }
  };
}

// Purpose: Return a reusable connected SQL pool, creating it on first use.
async function getPool() {
  if (!hasDatabaseConfig()) {
    throw new Error("Azure SQL configuration is incomplete.");
  }

  if (!poolPromise) {
    const pool = new sql.ConnectionPool(getDatabaseConfig());

    // Purpose: Reset the cached pool on connection pool errors.
    pool.on("error", (error) => {
      console.error("[db] connection pool error", error);
      poolPromise = null;
    });

    poolPromise = pool.connect();
  }

  return poolPromise;
}

// Purpose: Run a lightweight query to confirm the database is reachable.
async function checkDatabaseConnection() {
  const pool = await getPool();
  const result = await pool.request().query("SELECT 1 AS ok");
  return result.recordset[0]?.ok === 1;
}

// Purpose: Close the shared SQL pool during graceful shutdown.
async function closeDatabaseConnection() {
  if (!poolPromise) {
    return;
  }

  const pool = await poolPromise;
  poolPromise = null;
  await pool.close();
}

module.exports = {
  sql,
  hasDatabaseConfig,
  getPool,
  checkDatabaseConnection,
  closeDatabaseConnection
};
