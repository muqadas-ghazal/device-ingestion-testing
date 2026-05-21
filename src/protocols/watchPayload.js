// Purpose: Normalize, categorize, log, and persist incoming watch payloads.
const { persistVitalPayload } = require("../services/wonlexVitalsService");

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

const ACTIVITY_EVENT_TYPES = new Set([
  "upTodayActivity",
  "upRun",
  "upWalk",
  "upRide",
  "upFree"
]);

const SYSTEM_EVENT_TYPES = new Set(["login", "heartbeat"]);

// Purpose: Process one decoded watch payload from TCP ingestion.
function handleWatchPayload(message, transport) {
  const normalized = normalizeWatchMessage(message);
  const eventType = normalized.type;
  const receivedAt = new Date().toISOString();
  const category = getEventCategory(eventType);

  console.log(`[${receivedAt}] [${transport}] [${category}:${eventType || "missing-type"}]`);
  console.dir(normalized, { depth: null });
  // Purpose: Let the TCP layer ACK first; realtime and DB work continue in the background.
  setImmediate(() => persistWatchPayload(normalized));

  return normalized;
}

// Purpose: Merge wrapper and nested data fields into a consistent payload shape.
function normalizeWatchMessage(message) {
  const nestedData = isPlainObject(message.data) ? message.data : {};

  return {
    ...nestedData,
    ...message,
    type: message.type || nestedData.type,
    imei: message.imei || nestedData.imei,
    deviceModel: message.deviceModel || nestedData.deviceModel,
    timestamp: message.timestamp || nestedData.timestamp
  };
}

// Purpose: Classify event types for readable logs and future routing.
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

// Purpose: Persist supported payloads asynchronously without blocking ACKs.
function persistWatchPayload(normalized) {
  persistVitalPayload(normalized).catch((error) => {
    console.error("[db] failed to persist watch payload", error);
  });
}

// Purpose: Check whether a value is a non-array object.
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  handleWatchPayload,
  normalizeWatchMessage,
  getEventCategory
};
