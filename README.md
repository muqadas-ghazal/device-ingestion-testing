# Health Watch Direct Ingestion

This project receives Wonlex/health-watch data directly from devices, acknowledges the device protocol, and stores supported vitals in Azure SQL.

The main goal is:

```text
watch device -> TCP ingestion -> normalize packet -> calculate device/patient -> store vitals -> frontend/backend can read from DB
```

## What It Supports

- HTTP health checks and utility APIs.
- TCP device ingestion using the Wonlex `FCAF` framed JSON protocol.
- Azure SQL connection pooling.
- Creating rows in `DigimedDevices`.
- Storing incoming vitals in `DigimedPatientVitals`.

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
4. The vitals service checks whether the packet is a supported vital event.
5. The repository finds the device by `IMEI` in `DigimedDevices`.
6. It finds the assigned patient using `PatientAssignedDevice.FK_device_id = DigimedDevices.ID`.
7. It inserts the vital into `DigimedPatientVitals`.

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
TCP:       localhost:3001
```

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

Converts supported device events into `liveVitals` JSON and expands `upBatch` into multiple readings.

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
