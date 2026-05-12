// Purpose: Encode and decode the Wonlex TCP FCAF-framed JSON protocol.
const TCP_MAGIC = 0xfcaf;
const TCP_HEADER_BYTES = 4;

// Purpose: Create a chunk-safe decoder for TCP frames that may arrive split or combined.
function createTcpFrameDecoder(options = {}) {
  const maxJsonBytes = Number(options.maxJsonBytes || 1024 * 1024);
  let pending = Buffer.alloc(0);

  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      const frames = [];
      const warnings = [];

      while (pending.length >= TCP_HEADER_BYTES) {
        const magicIndex = findTcpMagicIndex(pending);

        if (magicIndex === -1) {
          const keepBytes = pending[pending.length - 1] === 0xfc ? 1 : 0;
          const discarded = pending.subarray(0, pending.length - keepBytes);

          if (discarded.length) {
            warnings.push(buildDecodeWarning("missing_fcaf_header", discarded));
          }

          pending = keepBytes ? pending.subarray(pending.length - keepBytes) : Buffer.alloc(0);
          break;
        }

        if (magicIndex > 0) {
          warnings.push(buildDecodeWarning("bytes_before_fcaf_header", pending.subarray(0, magicIndex)));
          pending = pending.subarray(magicIndex);
        }

        if (pending.length < TCP_HEADER_BYTES) {
          break;
        }

        const jsonLength = pending.readUInt16BE(2);

        if (jsonLength <= 0 || jsonLength > maxJsonBytes) {
          warnings.push(buildDecodeWarning("invalid_frame_length", pending.subarray(0, TCP_HEADER_BYTES), {
            frameLength: jsonLength,
            maxJsonBytes
          }));
          pending = pending.subarray(2);
          continue;
        }

        const packetLength = TCP_HEADER_BYTES + jsonLength;

        if (pending.length < packetLength) {
          break;
        }

        frames.push(pending.subarray(TCP_HEADER_BYTES, packetLength));
        pending = pending.subarray(packetLength);
      }

      return { frames, warnings };
    }
  };
}

// Purpose: Wrap a JSON payload in the 4-byte Wonlex TCP frame header.
function encodeTcpFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload), "utf8");

  if (json.length > 0xffff) {
    throw new Error(`TCP response JSON too large: ${json.length} bytes`);
  }

  const header = Buffer.alloc(TCP_HEADER_BYTES);
  header.writeUInt16BE(TCP_MAGIC, 0);
  header.writeUInt16BE(json.length, 2);
  return Buffer.concat([header, json]);
}

// Purpose: Check if a buffer starts with the Wonlex FCAF frame header.
function hasTcpMagicHeader(buffer) {
  return buffer.length >= TCP_HEADER_BYTES && buffer.readUInt16BE(0) === TCP_MAGIC;
}

// Purpose: Locate the next FCAF header inside a TCP byte stream buffer.
function findTcpMagicIndex(buffer) {
  for (let index = 0; index <= buffer.length - 2; index += 1) {
    if (buffer[index] === 0xfc && buffer[index + 1] === 0xaf) {
      return index;
    }
  }

  return -1;
}

// Purpose: Build structured diagnostics for bytes that cannot be decoded as an FCAF frame.
function buildDecodeWarning(reason, bytes, details = {}) {
  return {
    reason,
    discardedBytes: bytes.length,
    hexPreview: bytes.toString("hex", 0, Math.min(bytes.length, 96)),
    asciiPreview: toPrintableAscii(bytes.subarray(0, 96)),
    hint: guessPayloadType(bytes),
    ...details
  };
}

// Purpose: Make raw byte previews readable in logs without control characters.
function toPrintableAscii(buffer) {
  return Array.from(buffer, (byte) => {
    if (byte >= 0x20 && byte <= 0x7e) {
      return String.fromCharCode(byte);
    }

    return ".";
  }).join("");
}

// Purpose: Identify common accidental traffic sent to the raw TCP device port.
function guessPayloadType(buffer) {
  const ascii = toPrintableAscii(buffer.subarray(0, 16)).trimStart();

  if (/^(GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH)\s/i.test(ascii)) {
    return "looks_like_http_request";
  }

  if (buffer.length >= 2 && buffer[0] === 0x16 && buffer[1] === 0x03) {
    return "looks_like_tls_handshake";
  }

  if (ascii.startsWith("{") || ascii.startsWith("[")) {
    return "looks_like_unframed_json";
  }

  if (ascii.startsWith("SSH-")) {
    return "looks_like_ssh_probe";
  }

  return "unknown_non_fcaf_payload";
}

module.exports = {
  TCP_MAGIC,
  TCP_HEADER_BYTES,
  createTcpFrameDecoder,
  encodeTcpFrame,
  hasTcpMagicHeader
};
