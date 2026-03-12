type ProgressKind = "info" | "success" | "warning" | "error";

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY && process.env.NO_COLOR !== "1");
}

function color(kind: ProgressKind, text: string): string {
  if (!supportsColor()) {
    return text;
  }
  const codes: Record<ProgressKind, number> = {
    info: 36,
    success: 32,
    warning: 33,
    error: 31
  };
  return `\u001b[${codes[kind]}m${text}\u001b[0m`;
}

function formatBar(current: number, total: number, width = 20): string {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(current / safeTotal, 0), 1);
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(width - filled, 0))}`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class ProgressReporter {
  constructor(private readonly enabled: boolean) {}

  static forCli(jsonMode: boolean): ProgressReporter {
    return new ProgressReporter(!jsonMode);
  }

  stage(current: number, total: number, label: string, detail?: string): void {
    if (!this.enabled) {
      return;
    }
    const prefix = color("info", `[${formatBar(current, total)}]`);
    const suffix = detail ? ` ${detail}` : "";
    process.stdout.write(`${prefix} ${current}/${total} ${label}${suffix}\n`);
  }

  step(label: string, detail?: string): void {
    if (!this.enabled) {
      return;
    }
    const suffix = detail ? ` ${detail}` : "";
    process.stdout.write(`${color("info", "•")} ${label}${suffix}\n`);
  }

  scene(current: number, total: number, label: string): void {
    if (!this.enabled) {
      return;
    }
    process.stdout.write(`${color("info", "→")} Scene ${current}/${total}: ${label}\n`);
  }

  provider(sceneId: string, providerId: string, language: string): void {
    if (!this.enabled) {
      return;
    }
    process.stdout.write(`${color("info", "↳")} ${sceneId}: ${providerId} (${language})\n`);
  }

  status(kind: ProgressKind, label: string): void {
    if (!this.enabled) {
      return;
    }
    const icon = {
      info: "i",
      success: "✓",
      warning: "!",
      error: "x"
    }[kind];
    process.stdout.write(`${color(kind, `[${icon}]`)} ${label}\n`);
  }

  banner(label: string): void {
    if (!this.enabled) {
      return;
    }
    process.stdout.write(`\n${color("info", `== ${label} ==`)} ${timestamp()}\n`);
  }
}
