// Purpose: Build server-to-device Wonlex commands for direct TCP sessions.
const DEFAULT_HEALTH_INTERVAL_MINUTES = 1;
const DEFAULT_LOCATION_INTERVAL_SECONDS = 60;
const DEFAULT_COLLECTION_FREQUENCY = 5;

// Purpose: Build the health measurement frequency command described by the Wonlex protocol.
function buildDeviceMeasuringFrequencyCommand(imei, options = {}) {
  const intervalMinutes = readPositiveInt(
    options.healthIntervalMinutes,
    DEFAULT_HEALTH_INTERVAL_MINUTES
  );

  return buildDownlinkCommand("deviceMeasuringFrequency", imei, {
    configs: {
      upHeartRate: {
        interval: String(readPositiveInt(options.heartRateIntervalMinutes, intervalMinutes))
      },
      upBP: {
        interval: String(readPositiveInt(options.bpIntervalMinutes, intervalMinutes))
      },
      upBO: {
        frequency: readPositiveInt(options.boFrequency, DEFAULT_COLLECTION_FREQUENCY),
        interval: String(readPositiveInt(options.boIntervalMinutes, intervalMinutes))
      },
      upBodyTemperature: {
        frequency: readPositiveInt(options.temperatureFrequency, DEFAULT_COLLECTION_FREQUENCY),
        interval: String(readPositiveInt(options.temperatureIntervalMinutes, intervalMinutes))
      }
    }
  });
}

// Purpose: Build the location interval command. The protocol uses seconds for this value.
function buildLocationIntervalCommand(imei, options = {}) {
  return buildDownlinkCommand("locationInterval", imei, {
    intervalTime: readNonNegativeInt(
      options.locationIntervalSeconds,
      DEFAULT_LOCATION_INTERVAL_SECONDS
    )
  });
}

// Purpose: Return auto-configuration commands enabled by runtime options.
function buildLoginConfigurationCommands(imei, options = {}) {
  if (!imei || !isEnabled(options.autoConfigureOnLogin, true)) {
    return [];
  }

  const commands = [buildDeviceMeasuringFrequencyCommand(imei, options)];

  if (isEnabled(options.includeLocation, true)) {
    commands.push(buildLocationIntervalCommand(imei, options));
  }

  return commands;
}

// Purpose: Build a common server-originated command body with an instruction identifier.
function buildDownlinkCommand(type, imei, fields = {}) {
  return {
    type,
    ident: randomIdent(),
    ref: "s:update",
    imei,
    ...fields,
    timestamp: Date.now()
  };
}

// Purpose: Generate a six-digit identifier for matching command replies.
function randomIdent() {
  return Math.floor(100000 + Math.random() * 900000);
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readNonNegativeInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function isEnabled(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

module.exports = {
  buildDeviceMeasuringFrequencyCommand,
  buildLocationIntervalCommand,
  buildLoginConfigurationCommands
};
