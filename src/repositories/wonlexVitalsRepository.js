// Purpose: Encapsulate SQL lookups and inserts needed to persist Wonlex vital readings.
const { sql, getPool } = require("../db");

const DEVICE_CACHE_TTL_MS = Number(process.env.DEVICE_CACHE_TTL_MS || 60_000);
const deviceCache = new Map();

// Purpose: Resolve an incoming IMEI to DigimedDevices metadata and PatientAssignedDevice patient context.
async function findDeviceContextByImei(imei) {
  const normalizedImei = normalizeImei(imei);

  if (!normalizedImei) {
    return null;
  }

  const cached = deviceCache.get(normalizedImei);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pool = await getPool();
  const assignment = await findLatestAssignmentByImei(pool, normalizedImei);
  const deviceResult = await pool.request()
    .input("imei", sql.VarChar(32), normalizedImei)
    .query(`
      SELECT TOP 1 ID, DeviceID, DeviceType, PatientID, IMEI
      FROM DigimedDevices
      WHERE IMEI = @imei
      ORDER BY ID DESC
    `);

  const device = deviceResult.recordset[0];

  if (!device) {
    return cacheDeviceContext(normalizedImei, null);
  }

  return cacheDeviceContext(normalizedImei, {
    devicePk: device.ID,
    legacyDeviceId: device.DeviceID,
    deviceType: device.DeviceType,
    patientId: assignment?.PatientID ?? null,
    imei: normalizedImei
  });
}

// Purpose: Insert one normalized vital reading into DigimedPatientVitals.
async function insertPatientVital(vital) {
  const pool = await getPool();

  await pool.request()
    .input("deviceId", sql.NVarChar(255), vital.deviceId)
    .input("deviceType", sql.NVarChar(255), vital.deviceType)
    .input("patientId", sql.Int, vital.patientId)
    .input("liveVitals", sql.NVarChar(sql.MAX), JSON.stringify(vital.liveVitals))
    .input("hourlyVitals", sql.NVarChar(sql.MAX), "{}")
    .input("fkDeviceId", sql.Int, vital.fkDeviceId)
    .input("createdAt", sql.DateTimeOffset, vital.createdAt)
    .input("updatedAt", sql.DateTimeOffset, vital.updatedAt)
    .query(`
      INSERT INTO DigimedPatientVitals (
        DeviceID,
        DeviceType,
        PatientID,
        liveVitals,
        HourlyVitals,
        createdAt,
        updatedAt,
        FK_device_id
      )
      VALUES (
        @deviceId,
        @deviceType,
        @patientId,
        @liveVitals,
        @hourlyVitals,
        @createdAt,
        @updatedAt,
        @fkDeviceId
      )
    `);
}

// Purpose: Find the latest patient assignment where PatientAssignedDevice.DeviceID stores the device IMEI.
async function findLatestAssignmentByImei(pool, imei) {
  const result = await pool.request()
    .input("imei", sql.NVarChar(255), imei)
    .query(`
      SELECT TOP 1 PatientID
      FROM PatientAssignedDevice
      WHERE DeviceID = @imei
      ORDER BY updatedAt DESC, ID DESC
    `);

  return result.recordset[0] || null;
}

// Purpose: Cache resolved device context briefly to reduce repeated lookup queries.
function cacheDeviceContext(imei, value) {
  deviceCache.set(imei, {
    value,
    expiresAt: Date.now() + DEVICE_CACHE_TTL_MS
  });

  return value;
}

// Purpose: Normalize IMEI values before SQL lookup and cache access.
function normalizeImei(imei) {
  if (imei == null) {
    return "";
  }

  return String(imei).trim();
}

module.exports = {
  findDeviceContextByImei,
  insertPatientVital
};
