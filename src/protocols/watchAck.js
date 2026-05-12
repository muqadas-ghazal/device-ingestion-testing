// Purpose: Build and send watch protocol ACK/error responses.
// Purpose: Build a success acknowledgement that mirrors the incoming message identity.
function buildAckPayload(message) {
  const now = Date.now();
  const ackType = message.type || "unknown";

  return {
    type: ackType,
    ident: message.ident,
    ref: "s:reply",
    imei: message.imei,
    data: {
      type: ackType,
      imei: message.imei,
      timestamp: now,
      status: "success"
    },
    extend: null,
    timestamp: now
  };
}

// Purpose: Build a protocol error response with a machine-readable reason.
function buildErrorPayload(reason) {
  return {
    type: "error",
    ref: "s:reply",
    data: { status: "failed", reason },
    timestamp: Date.now()
  };
}

module.exports = {
  buildAckPayload,
  buildErrorPayload
};
