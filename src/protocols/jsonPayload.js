// Purpose: Provide safe JSON parsing and invalid-payload logging helpers.
// Purpose: Parse a TCP frame body buffer as UTF-8 JSON.
function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    return null;
  }
}

module.exports = {
  parseJsonBuffer
};
