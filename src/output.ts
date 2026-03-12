export type JsonOutput = {
  status: "ok" | "error";
  stage?: string;
  runId?: string;
  message?: string;
  artifacts?: Record<string, string | string[]>;
  data?: Record<string, unknown>;
  errors?: Array<Record<string, unknown>>;
  nextActions?: string[];
};

export function printOutput(payload: JsonOutput, asJson = false): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (payload.message) {
    process.stdout.write(`${payload.message}\n`);
  }
  if (payload.artifacts) {
    for (const [key, value] of Object.entries(payload.artifacts)) {
      process.stdout.write(`${key}: ${JSON.stringify(value)}\n`);
    }
  }
}
