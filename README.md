# Health Watch Direct Ingestion

This project receives Wonlex/health-watch data directly from devices, acknowledges the device protocol, and stores supported vitals in Azure SQL.

The main goal is:

```text
watch device -> TCP ingestion -> normalize packet -> ACK device -> emit realtime vitals -> store vitals
```

## What It Supports

- HTTP health checks and utility APIs.
- TCP device ingestion using the Wonlex `FCAF` framed JSON protocol.
- Azure SQL connection pooling.
- Creating rows in `DigimedDevices`.
- Storing incoming vitals in `DigimedPatientVitals`.
- Realtime Socket.IO events for Bubble/frontend live monitoring.
- Swagger/OpenAPI docs at `/api-docs` and `/openapi.json`.

Supported vital events:

```text
upHeartRate
upBP
upBO
upBodyTemperature
upBatch
```

## Runtime Flow

1. A device sends an `FCAF` framed JSON packet over raw TCP.
2. The transport layer decodes the packet into JSON.
3. The protocol layer normalizes the message and sends an ACK back to the device.
4. The TCP layer sends an ACK back to the device immediately.
5. In the background, the vitals service checks whether the packet is a supported vital event.
6. The repository finds the device by `IMEI` in `DigimedDevices`.
7. It finds the assigned patient using `PatientAssignedDevice.DeviceID = IMEI`.
8. It finds the patient's facility using `Patients.PatientID -> Patients.FacilityID`.
9. It emits a Socket.IO `watch:vital` event before inserting into the database.
10. It inserts the vital into `DigimedPatientVitals`.

Example stored `liveVitals` values:

```json
{ "heartRate": 100 }
{ "spo2": 97 }
{ "bloodPressure": "120/80/88", "systolic": 120, "diastolic": 80, "pulse": 88 }
{ "temperature": 36.8, "bodyTemperature": 36.8, "surfaceTemperature": 31.6, "environmentTemperature": 28.2 }
```

## Run

Create a local `.env` file:

```env
PORT=3000
TCP_PORT=3001
MAX_JSON_BYTES=65535
WATCH_PACKET_DEBUG=0
SOCKET_CORS_ORIGIN=*
WATCH_AUTO_CONFIGURE_ON_LOGIN=1
WATCH_HEALTH_INTERVAL_MINUTES=1
WATCH_LOCATION_INTERVAL_SECONDS=60
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database
AZURE_SQL_USER=your-user
AZURE_SQL_PASSWORD=your-password
AZURE_SQL_PORT=1433
```

Install and start:

```powershell
npm install
npm start
```

Default endpoints:

```text
HTTP:      http://localhost:3000
Health:    http://localhost:3000/health
DB Health: http://localhost:3000/health/db
Swagger:   http://localhost:3000/api-docs
OpenAPI:   http://localhost:3000/openapi.json
TCP:       localhost:3001
```

## Realtime Socket.IO For Bubble

The frontend connects to the same HTTP origin that serves the API:

```js
const socket = io("https://your-api-domain");
```

Professional live monitoring screen:

```js
socket.emit("watch:subscribe", {
  scope: "facility",
  facilityId: 10
});
```

Patient detail screen:

```js
socket.emit("watch:subscribe", {
  scope: "patient",
  patientId: 123
});
```

Optional device debug screen:

```js
socket.emit("watch:subscribe", {
  scope: "device",
  imei: "865028000000306"
});
```

Listen for vitals:

```js
socket.on("watch:vital", (event) => {
  console.log(event);
});
```

The server uses these rooms:

```text
facility:{facilityId}  all patients in a facility
patient:{patientId}    one patient detail screen
device:{imei}          one watch/device debug view
```

Example realtime payload:

```json
{
  "category": "health",
  "type": "upHeartRate",
  "imei": "865028000000306",
  "patientId": 123,
  "facilityId": 10,
  "deviceId": "865028000000306",
  "fkDeviceId": 45,
  "deviceType": "wonlex_watch",
  "deviceModel": "HW20",
  "liveVitals": {
    "heartRate": 100
  },
  "measuredAt": "2026-05-21T07:08:58.000Z",
  "receivedAt": "2026-05-21T07:09:00.000Z"
}
```

When `watch:subscribe` is called, the server leaves previous watch rooms by default. Pass
`replace: false` if the same socket intentionally needs multiple subscriptions.

To inspect real watch packets while you are learning the device format, enable packet debug logs:

```powershell
$env:WATCH_PACKET_DEBUG="1"; npm start
```

The TCP terminal will print raw chunk bytes, decoded frame bytes, printable ASCII, and parsed JSON keys/type/IMEI when the packet is JSON.

When `WATCH_AUTO_CONFIGURE_ON_LOGIN` is enabled, the TCP server sends these Wonlex downlink
commands after a device login is acknowledged:

```text
deviceMeasuringFrequency: upHeartRate, upBP, upBO, upBodyTemperature
locationInterval
```

Useful optional overrides:

```env
WATCH_HEART_RATE_INTERVAL_MINUTES=1
WATCH_BP_INTERVAL_MINUTES=1
WATCH_BO_INTERVAL_MINUTES=1
WATCH_TEMPERATURE_INTERVAL_MINUTES=1
WATCH_BO_FREQUENCY=5
WATCH_TEMPERATURE_FREQUENCY=5
WATCH_INCLUDE_LOCATION=1
WATCH_LOCATION_INTERVAL_SECONDS=60
```

## HTTP APIs

Create a device in `DigimedDevices`:

```text
POST /api/digimed-devices
```

Body:

```json
{
  "DeviceID": 5,
  "DeviceType": "wonlex_watch",
  "PatientID": null,
  "IMEI": "865028000000001"
}
```

The API rejects duplicate IMEIs.

## File Responsibilities

`src/server.js`

Starts the app. It loads `.env`, configures Express, mounts routes, starts the TCP server, checks DB connectivity, and handles shutdown.

`src/db.js`

Creates and reuses the Azure SQL connection pool. Also exposes DB health and graceful close helpers.

`src/routes/health.routes.js`

Contains `/health` and `/health/db`.

`src/routes/digimedDevices.routes.js`

Contains the API for creating `DigimedDevices` records and validates the request body.

`src/tcp/tcpFrameCodec.js`

Encodes and decodes the Wonlex TCP frame format:

```text
2 bytes magic: 0xFC 0xAF
2 bytes JSON length
JSON payload
```

`src/tcp/watchTcpServer.js`

Accepts TCP connections, decodes frames, parses JSON, handles watch payloads, and sends framed ACK/error responses.

`src/protocols/watchPayload.js`

Normalizes watch payloads, categorizes event types, logs packets, and triggers persistence.

`src/protocols/watchAck.js`

Builds protocol ACK/error payloads for TCP responses.

`src/protocols/jsonPayload.js`

Safe JSON parsing and invalid payload logging helpers.

`src/services/wonlexVitalsService.js`

Converts supported device events into `liveVitals` JSON, emits realtime events, and expands `upBatch` into multiple readings.

`src/realtime/watchRealtime.js`

Initializes Socket.IO, manages facility/patient/device rooms, and emits `watch:vital`.

`src/docs/openapi.js`

Contains the Swagger/OpenAPI document and the Socket.IO integration guide for Bubble developers.

`src/repositories/wonlexVitalsRepository.js`

Handles SQL lookups and inserts for vitals:

```text
IMEI -> DigimedDevices.ID -> PatientAssignedDevice.PatientID -> DigimedPatientVitals
```

`src/repositories/wonlexDevicesRepository.js`

Handles SQL operations for `DigimedDevices`.

## Notes

- The `scripts/` folder is ignored by git because it is for local/manual testing.
- `.env` is ignored by git and should contain local secrets only.
- Device `PatientID` insertion depends on the database foreign key setup for `DigimedPatientVitals.PatientID`.
