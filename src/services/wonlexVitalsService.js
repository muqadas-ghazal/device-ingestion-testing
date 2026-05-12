// Purpose: Convert Wonlex health events into liveVitals JSON and persist them.
const {
  findDeviceContextByImei,
  insertPatientVital
} = require("../repositories/wonlexVitalsRepository");

const VITAL_EVENT_TYPES = new Set([
  "upHeartRate",
  "upBP",
  "upBO",
  "upBodyTemperature",
  "upBatch"
]);

// Purpose: Persist supported vital packets after resolving their device context.
async function persistVitalPayload(payload) {
  if (!VITAL_EVENT_TYPES.has(payload.type)) {
    return;
  }

  const imei = normalizeString(payload.imei);

  if (!imei) {
    console.warn("[db] vital payload skipped: missing imei");
    return;
  }

  const device = await findDeviceContextByImei(imei);

  if (!device) {
    console.warn(`[db] vital payload skipped: no DigimedDevices row for imei=${imei}`);
    return;
  }

  const readings = buildVitalReadings(payload);

  if (!readings.length) {
    console.warn(`[db] vital payload skipped: unsupported vital shape type=${payload.type}`);
    return;
  }

  for (const reading of readings) {
    await insertPatientVital({
      deviceId: imei,
      deviceType: device.deviceType || payload.deviceModel || "wonlex_watch",
      patientId: device.patientId,
      fkDeviceId: device.devicePk,
      liveVitals: reading.liveVitals,
      createdAt: reading.measuredAt,
      updatedAt: new Date()
    });
  }

  console.log(`[db] stored ${readings.length} vital reading(s) imei=${imei}`);
}

// Purpose: Convert a single payload into one or more normalized vital readings.
function buildVitalReadings(payload) {
  if (payload.type === "upBatch") {
    return buildBatchReadings(payload);
  }

  const measuredAt = toDate(payload.timestamp) || new Date();
  const liveVitals = buildLiveVitals(payload.type, payload.date ?? payload.data);

  return liveVitals ? [{ liveVitals, measuredAt }] : [];
}

// Purpose: Expand an upBatch payload into individual reading records.
function buildBatchReadings(payload) {
  const dataType = normalizeString(payload.dataType);
  const values = splitCsv(payload.data);
  const timestamps = splitCsv(payload.dataTime);
  const readings = [];

  for (let index = 0; index < values.length; index += 1) {
    const liveVitals = buildLiveVitals(dataType, values[index]);

    if (!liveVitals) {
      continue;
    }

    readings.push({
      liveVitals,
      measuredAt: toDate(timestamps[index]) || toDate(payload.timestamp) || new Date()
    });
  }

  return readings;
}

// Purpose: Map a Wonlex event/value pair into the liveVitals JSON shape.
function buildLiveVitals(eventType, rawValue) {
  const value = normalizeString(rawValue);

  if (!value) {
    return null;
  }

  if (eventType === "upHeartRate") {
    return { heartRate: toNumber(value) };
  }

  if (eventType === "upBO") {
    return { spo2: toNumber(value) };
  }

  if (eventType === "upBP") {
    const [systolic, diastolic, pulse] = value.split("/").map(toNumber);

    return {
      bloodPressure: value,
      systolic,
      diastolic,
      pulse
    };
  }

  if (eventType === "upBodyTemperature") {
    const [body, surface, environment] = value.split("/").map(toNumber);

    return {
      temperature: body,
      bodyTemperature: body,
      surfaceTemperature: surface,
      environmentTemperature: environment
    };
  }

  return null;
}

// Purpose: Split comma-separated batch fields into clean non-empty values.
function splitCsv(value) {
  return normalizeString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Purpose: Convert second or millisecond timestamps into Date objects.
function toDate(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return new Date(number < 10_000_000_000 ? number * 1000 : number);
}

// Purpose: Convert numeric strings to numbers while preserving invalid values as null.
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Purpose: Normalize optional values into trimmed strings.
function normalizeString(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

module.exports = {
  persistVitalPayload
};
