// Purpose: Publish a compact OpenAPI guide for HTTP APIs and Bubble Socket.IO integration.
const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Health Watch Ingestion API",
    version: "1.0.0",
    description:
      "HTTP endpoints plus Socket.IO event guide for Bubble/frontend live watch vitals.\n\n" +
      "Socket.IO guide:\n\n" +
      "- Connect to the same HTTP origin, for example `io('https://api.example.com')`.\n" +
      "- Professional live monitoring screen subscribes with `{ scope: 'facility', facilityId: 10 }`.\n" +
      "- Patient detail screen subscribes with `{ scope: 'patient', patientId: 123 }`.\n" +
      "- Optional device debug screen subscribes with `{ scope: 'device', imei: '865028000000306' }`.\n" +
      "- Listen for `watch:vital`. Payload includes `patientId`, `facilityId`, `imei`, and `liveVitals`.\n" +
      "- Calling `watch:subscribe` replaces previous watch rooms unless `replace: false` is sent."
  },
  servers: [
    {
      url: "/",
      description: "Current server"
    }
  ],
  paths: {
    "/": {
      get: {
        summary: "Service metadata",
        responses: {
          200: {
            description: "Service status and TCP port"
          }
        }
      }
    },
    "/health": {
      get: {
        summary: "Service health check",
        responses: {
          200: {
            description: "Service is running"
          }
        }
      }
    },
    "/health/db": {
      get: {
        summary: "Database health check",
        responses: {
          200: {
            description: "Database connection is healthy"
          },
          503: {
            description: "Database connection is not available"
          }
        }
      }
    },
    "/api/digimed-devices": {
      post: {
        summary: "Create a DigimedDevices row for a watch IMEI",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["DeviceID", "DeviceType", "IMEI"],
                properties: {
                  DeviceID: { type: "integer", example: 5 },
                  DeviceType: { type: "string", example: "wonlex_watch" },
                  PatientID: { type: "integer", nullable: true, example: null },
                  IMEI: { type: "string", example: "865028000000306" }
                }
              }
            }
          }
        },
        responses: {
          201: { description: "Device created" },
          400: { description: "Invalid request body" },
          409: { description: "IMEI already exists" },
          500: { description: "Create failed" }
        }
      }
    }
  },
  components: {
    schemas: {
      WatchVitalEvent: {
        type: "object",
        properties: {
          category: { type: "string", example: "health" },
          type: { type: "string", example: "upHeartRate" },
          imei: { type: "string", example: "865028000000306" },
          patientId: { type: "integer", nullable: true, example: 123 },
          facilityId: { type: "integer", nullable: true, example: 10 },
          deviceId: { type: "string", example: "865028000000306" },
          fkDeviceId: { type: "integer", example: 45 },
          deviceType: { type: "string", example: "wonlex_watch" },
          deviceModel: { type: "string", example: "HW20" },
          liveVitals: {
            type: "object",
            example: { heartRate: 100 }
          },
          measuredAt: { type: "string", format: "date-time" },
          receivedAt: { type: "string", format: "date-time" },
          raw: { type: "object" }
        }
      }
    }
  },
  "x-socket-io": {
    url: "Same HTTP origin, for example https://api.example.com",
    clientPackage: "socket.io-client",
    subscribeEvent: "watch:subscribe",
    unsubscribeEvent: "watch:unsubscribe",
    serverEvent: "watch:vital",
    rooms: [
      {
        screen: "Professional Live Monitoring",
        request: { scope: "facility", facilityId: 10 },
        room: "facility:10",
        purpose: "Receive vitals for all patients in one facility."
      },
      {
        screen: "Patient Detail",
        request: { scope: "patient", patientId: 123 },
        room: "patient:123",
        purpose: "Receive vitals for one patient only."
      },
      {
        screen: "Device Debug",
        request: { scope: "device", imei: "865028000000306" },
        room: "device:865028000000306",
        purpose: "Receive vitals for one watch IMEI."
      }
    ],
    bubbleExample: [
      "const socket = io('https://api.example.com');",
      "socket.emit('watch:subscribe', { scope: 'facility', facilityId: 10 });",
      "socket.on('watch:vital', function (event) { console.log(event); });",
      "socket.emit('watch:subscribe', { scope: 'patient', patientId: 123 });"
    ],
    eventExample: {
      category: "health",
      type: "upHeartRate",
      imei: "865028000000306",
      patientId: 123,
      facilityId: 10,
      deviceId: "865028000000306",
      fkDeviceId: 45,
      deviceType: "wonlex_watch",
      deviceModel: "HW20",
      liveVitals: { heartRate: 100 },
      measuredAt: "2026-05-21T07:08:58.000Z",
      receivedAt: "2026-05-21T07:09:00.000Z"
    }
  }
};

module.exports = { openApiDocument };
