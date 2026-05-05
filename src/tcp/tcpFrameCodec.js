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
          warnings.push(`discarded ${pending.length} byte(s) without FCAF header`);
          pending = Buffer.alloc(0);
          break;
        }

        if (magicIndex > 0) {
          warnings.push(`discarded ${magicIndex} byte(s) before FCAF header`);
          pending = pending.subarray(magicIndex);
        }

        if (pending.length < TCP_HEADER_BYTES) {
          break;
        }

        const jsonLength = pending.readUInt16BE(2);

        if (jsonLength <= 0 || jsonLength > maxJsonBytes) {
          warnings.push(`invalid frame length ${jsonLength}; dropping header`);
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

module.exports = {
  TCP_MAGIC,
  TCP_HEADER_BYTES,
  createTcpFrameDecoder,
  encodeTcpFrame,
  hasTcpMagicHeader
};
