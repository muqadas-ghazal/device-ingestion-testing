// Purpose: Own Socket.IO setup and room-based watch event delivery for Bubble/frontend clients.
const { Server } = require("socket.io");

let io = null;

// Purpose: Attach Socket.IO to the existing HTTP server.
function initializeWatchRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    socket.data.watchRooms = new Set();
    console.log(`[realtime] client connected id=${socket.id}`);

    socket.on("watch:subscribe", (request = {}, reply) => {
      const result = subscribeSocket(socket, request);
      acknowledge(reply, result);
    });

    socket.on("watch:unsubscribe", (request = {}, reply) => {
      const result = unsubscribeSocket(socket, request);
      acknowledge(reply, result);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[realtime] client disconnected id=${socket.id} reason=${reason}`);
    });
  });

  console.log("[realtime] Socket.IO ready");
  return io;
}

// Purpose: Emit one normalized vital event to facility, patient, and device rooms when available.
function emitVitalEvent(event) {
  if (!io) {
    console.warn("[realtime] watch:vital skipped: Socket.IO not initialized");
    return;
  }

  const rooms = buildEmitRooms(event);

  if (!rooms.length) {
    console.warn(`[realtime] watch:vital skipped: no target room imei=${event.imei || "-"}`);
    return;
  }

  for (const room of rooms) {
    io.to(room).emit("watch:vital", event);
  }

  console.log(
    `[realtime] emit watch:vital type=${event.type} imei=${event.imei || "-"} ` +
      `patientId=${event.patientId ?? "-"} facilityId=${event.facilityId ?? "-"} rooms=${rooms.join(",")}`
  );
}

// Purpose: Join one frontend socket to a facility, patient, or device room.
function subscribeSocket(socket, request) {
  const room = getRoomFromRequest(request);

  if (!room) {
    return { ok: false, error: "invalid_subscription_scope" };
  }

  if (request.replace !== false) {
    leaveWatchRooms(socket);
  }

  socket.join(room);
  socket.data.watchRooms.add(room);
  console.log(`[realtime] subscribed id=${socket.id} room=${room}`);

  return { ok: true, room };
}

// Purpose: Leave a requested watch room, or all watch rooms when no valid room is supplied.
function unsubscribeSocket(socket, request) {
  const room = getRoomFromRequest(request);

  if (!room) {
    leaveWatchRooms(socket);
    return { ok: true, room: null };
  }

  socket.leave(room);
  socket.data.watchRooms.delete(room);
  console.log(`[realtime] unsubscribed id=${socket.id} room=${room}`);

  return { ok: true, room };
}

// Purpose: Convert a subscription request into the backend room name.
function getRoomFromRequest(request) {
  const scope = normalizeString(request.scope);

  if (scope === "facility" && request.facilityId != null) {
    return `facility:${request.facilityId}`;
  }

  if (scope === "patient" && request.patientId != null) {
    return `patient:${request.patientId}`;
  }

  if (scope === "device" && request.imei != null) {
    return `device:${normalizeString(request.imei)}`;
  }

  return null;
}

// Purpose: Build all rooms that should receive a vital update.
function buildEmitRooms(event) {
  const rooms = [];

  if (event.facilityId != null) {
    rooms.push(`facility:${event.facilityId}`);
  }

  if (event.patientId != null) {
    rooms.push(`patient:${event.patientId}`);
  }

  if (event.imei) {
    rooms.push(`device:${event.imei}`);
  }

  return rooms;
}

// Purpose: Leave only rooms created by the watch realtime feature.
function leaveWatchRooms(socket) {
  for (const room of socket.data.watchRooms || []) {
    socket.leave(room);
    console.log(`[realtime] unsubscribed id=${socket.id} room=${room}`);
  }

  socket.data.watchRooms = new Set();
}

// Purpose: Support Socket.IO acknowledgement callbacks without requiring them.
function acknowledge(reply, payload) {
  if (typeof reply === "function") {
    reply(payload);
  }
}

// Purpose: Normalize optional room values into strings.
function normalizeString(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

module.exports = {
  initializeWatchRealtime,
  emitVitalEvent
};
