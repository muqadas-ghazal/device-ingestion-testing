// Purpose: Encapsulate SQL operations for DigimedDevices records.
const { sql, getPool } = require("../db");

// Purpose: Insert a new device row and return the inserted record.
async function createDigimedDevice(device) {
  const pool = await getPool();
  const result = await pool.request()
    .input("deviceId", sql.Int, device.deviceId)
    .input("deviceType", sql.NVarChar(255), device.deviceType)
    .input("patientId", sql.Int, device.patientId)
    .input("imei", sql.VarChar(32), device.imei)
    .query(`
      INSERT INTO DigimedDevices (
        DeviceID,
        DeviceType,
        PatientID,
        createdAt,
        updatedAt,
        IMEI
      )
      OUTPUT
        inserted.ID,
        inserted.DeviceID,
        inserted.DeviceType,
        inserted.PatientID,
        inserted.createdAt,
        inserted.updatedAt,
        inserted.IMEI
      VALUES (
        @deviceId,
        @deviceType,
        @patientId,
        SYSDATETIMEOFFSET(),
        SYSDATETIMEOFFSET(),
        @imei
      )
    `);

  return result.recordset[0];
}

// Purpose: Find the newest device row matching a given IMEI.
async function findDigimedDeviceByImei(imei) {
  const pool = await getPool();
  const result = await pool.request()
    .input("imei", sql.VarChar(32), imei)
    .query(`
      SELECT TOP 1 ID, DeviceID, DeviceType, PatientID, createdAt, updatedAt, IMEI
      FROM DigimedDevices
      WHERE IMEI = @imei
      ORDER BY ID DESC
    `);

  return result.recordset[0] || null;
}

module.exports = {
  createDigimedDevice,
  findDigimedDeviceByImei
};
