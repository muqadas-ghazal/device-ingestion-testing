# Health Watch Direct Ingestion Server

This server implements direct ingestion from health watches for deployment/testing with manufacturers. It supports:

```text
HTTP health checks
WebSocket JSON messages
TCP FCAF-framed JSON packets
```

Every decoded message is logged to the console. The server also replies with a protocol-style acknowledgement using the same `ident` value when the device provides one.

## Run

```bash
npm install
npm run dev
```

Default endpoints:

```text
HTTP:       http://localhost:3000
Health:     http://localhost:3000/health
WebSocket:  ws://localhost:3000/watch
TCP:        localhost:3001
```

Override config with environment variables:

```powershell
$env:PORT="4000"
$env:TCP_PORT="4001"
$env:WS_PATH="/watch"
npm start
```

For deployment, give the manufacturer:

```text
WebSocket: ws://YOUR_SERVER_IP:3000/watch
TCP:       YOUR_SERVER_IP:3001
```

## Events Logged

System:

```text
login
heartbeat
```

Health:

```text
upHeartRate
upBP
upBO
upBodyTemperature
upBS
upBF
upUA
upECG
upHRV
upPPG
upRR
upBatch
```

Activity packets are also logged because they may contain health-related fields:

```text
upTodayActivity
upRun
upWalk
upRide
upFree
```

## Test Payloads

Login:

```json
{
  "type": "login",
  "ident": 762250,
  "ref": "w:update",
  "imei": "865028000000306",
  "deviceModel": "HW20",
  "timestamp": 1648111390074
}
```

Heart rate:

```json
{
  "type": "upHeartRate",
  "ident": 762251,
  "ref": "w:update",
  "imei": "865028000000306",
  "deviceModel": "HW20",
  "testType": 0,
  "date": "100",
  "timestamp": 1648111390074
}
```

Batch heart rate:

```json
{
  "type": "upBatch",
  "ident": 762252,
  "ref": "w:update",
  "imei": "865028000000306",
  "deviceModel": "HW20",
  "dataType": "upHeartRate",
  "data": "100,98,97",
  "dataTime": "1648111390075,1648111390073,1648111390074",
  "timestamp": 1648111390074
}
```

## TCP Packet Format

The TCP protocol uses a 4-byte header followed by UTF-8 JSON:

```text
Bytes 0-1: 0xFC 0xAF
Bytes 2-3: JSON byte length, unsigned big-endian
Bytes 4-n: JSON payload
```

The server is chunk-safe: a packet may arrive split across multiple TCP chunks, or multiple packets may arrive together. It buffers data until a complete frame is available.

TCP test client:

```powershell
@'
const net = require("net");

function encode(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xfcaf, 0);
  header.writeUInt16BE(json.length, 2);
  return Buffer.concat([header, json]);
}

const client = net.createConnection({ host: "127.0.0.1", port: 3001 }, () => {
  client.write(encode({
    type: "upHeartRate",
    ident: 762251,
    ref: "w:update",
    imei: "865028000000306",
    deviceModel: "HW20",
    testType: 0,
    date: "100",
    timestamp: Date.now()
  }));
});

client.on("data", (chunk) => {
  console.log("ACK hex:", chunk.toString("hex"));
  console.log("ACK json:", chunk.subarray(4).toString("utf8"));
  client.end();
});
'@ | node -
```
