// Purpose: Define APIs for creating and validating DigimedDevices records.
const express = require("express");
const {
  createDigimedDevice,
  findDigimedDeviceByImei
} = require("../repositories/wonlexDevicesRepository");

// Purpose: Create the router that owns DigimedDevices HTTP endpoints.
function createDigimedDevicesRouter() {
  const router = express.Router();

  // Purpose: Create a device row after validating body and duplicate IMEI.
  router.post("/", async (req, res) => {
    const parsed = parseCreateDeviceRequest(req.body);

    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: parsed.error });
      return;
    }

    try {
      const existing = await findDigimedDeviceByImei(parsed.device.imei);

      if (existing) {
        res.status(409).json({
          ok: false,
          error: "imei_already_exists",
          device: existing
        });
        return;
      }

      const device = await createDigimedDevice(parsed.device);
      res.status(201).json({ ok: true, device });
    } catch (error) {
      console.error("[api] failed to create DigimedDevices row", error);
      res.status(500).json({ ok: false, error: "device_create_failed" });
    }
  });

  return router;
}

// Purpose: Convert and validate incoming create-device request bodies.
function parseCreateDeviceRequest(body) {
  if (!isPlainObject(body)) {
    return { ok: false, error: "request_body_must_be_json_object" };
  }

  const deviceId = toOptionalInteger(body.DeviceID ?? body.deviceId);
  const patientId = toOptionalInteger(body.PatientID ?? body.patientId);
  const deviceType = normalizeString(body.DeviceType ?? body.deviceType);
  const imei = normalizeString(body.IMEI ?? body.imei);

  if (deviceId == null) {
    return { ok: false, error: "deviceId_is_required" };
  }

  if (!deviceType) {
    return { ok: false, error: "deviceType_is_required" };
  }

  if (!imei) {
    return { ok: false, error: "imei_is_required" };
  }

  if (imei.length > 32) {
    return { ok: false, error: "imei_must_be_32_chars_or_less" };
  }

  return {
    ok: true,
    device: {
      deviceId,
      deviceType,
      patientId,
      imei
    }
  };
}

// Purpose: Convert optional request values into integers or null.
function toOptionalInteger(value) {
  if (value == null || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isInteger(number)) {
    return null;
  }

  return number;
}

// Purpose: Normalize optional request values into trimmed strings.
function normalizeString(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

// Purpose: Check whether a value is a non-array object.
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = { createDigimedDevicesRouter };
