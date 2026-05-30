class GatewayError extends Error {
  constructor(code, message, details = undefined, exitCode = 1) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

module.exports = { GatewayError };
