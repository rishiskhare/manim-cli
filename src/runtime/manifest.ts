import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.js";
import { RUNTIME_DEFAULT_CHANNEL, RUNTIME_MANIFEST_FILENAME } from "../constants.js";
import { getPackageRoot } from "../utils/packageRoot.js";

export type RuntimePlatform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

export type RuntimeBundle = {
  version: string;
  platform: RuntimePlatform;
  archiveUrl: string;
  sha256: string;
  minimumCliVersion: string;
  archiveType?: "tar.gz" | "zip";
  installStrategy?: "archive" | "bootstrap";
};

export type RuntimeManifest = {
  channel: string;
  generatedAt: string;
  bundles: RuntimeBundle[];
};

const SUPPORTED_PLATFORMS: RuntimePlatform[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];

function validateBundleMetadata(bundle: RuntimeBundle): void {
  if (!/^https?:\/\/|^file:\/\//.test(bundle.archiveUrl)) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Runtime bundle URL must be absolute for ${bundle.platform} ${bundle.version}.`);
  }
  if (!/^[a-f0-9]{64}$/i.test(bundle.sha256)) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Runtime bundle checksum is invalid for ${bundle.platform} ${bundle.version}.`);
  }
}

export function getCurrentPlatform(): RuntimePlatform {
  const key = `${process.platform}-${process.arch}`;
  if (
    key === "darwin-arm64" ||
    key === "darwin-x64" ||
    key === "linux-x64" ||
    key === "linux-arm64" ||
    key === "win32-x64"
  ) {
    return key;
  }
  throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Unsupported platform: ${key}`);
}

function defaultManifestLocation(): string {
  return path.resolve(getPackageRoot(), "runtime", RUNTIME_MANIFEST_FILENAME);
}

async function loadManifestFromLocation(location: string): Promise<RuntimeManifest> {
  if (/^https?:\/\//.test(location)) {
    const response = await fetch(location);
    if (!response.ok) {
      throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Failed to fetch runtime manifest: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as RuntimeManifest;
  }

  const resolvedPath = location.startsWith("file://") ? new URL(location) : path.resolve(location);
  const raw = await fs.readFile(resolvedPath instanceof URL ? resolvedPath : resolvedPath, "utf8");
  return JSON.parse(raw) as RuntimeManifest;
}

export async function loadRuntimeManifest(): Promise<RuntimeManifest> {
  const override = process.env.MANIM_CLI_RUNTIME_MANIFEST;
  const manifest = await loadManifestFromLocation(override ?? defaultManifestLocation());
  const seen = new Set<string>();
  for (const bundle of manifest.bundles) {
    if (!SUPPORTED_PLATFORMS.includes(bundle.platform)) {
      throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Unsupported runtime platform in manifest: ${bundle.platform}`);
    }
    const key = `${bundle.platform}:${bundle.version}`;
    if (seen.has(key)) {
      throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Duplicate runtime bundle entry in manifest: ${key}`);
    }
    seen.add(key);
  }
  return manifest;
}

function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
}

export function isRuntimeCompatible(minimumCliVersion: string, currentCliVersion: string): boolean {
  const min = parseVersion(minimumCliVersion);
  const current = parseVersion(currentCliVersion);
  const length = Math.max(min.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const left = current[index] ?? 0;
    const right = min[index] ?? 0;
    if (left > right) {
      return true;
    }
    if (left < right) {
      return false;
    }
  }
  return true;
}

export async function resolveRuntimeBundle(currentCliVersion: string): Promise<RuntimeBundle> {
  const manifest = await loadRuntimeManifest();
  if (manifest.bundles.length === 0) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", "Runtime manifest contains no bundles. Publish runtime archives before shipping this package.");
  }
  const platform = getCurrentPlatform();
  const bundle = manifest.bundles
    .filter((candidate) => candidate.platform === platform)
    .filter((candidate) => isRuntimeCompatible(candidate.minimumCliVersion, currentCliVersion))
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];

  if (!bundle) {
    throw new CliError(
      "RUNTIME_BOOTSTRAP_FAILED",
      `No managed runtime bundle is available for ${platform} on channel ${manifest.channel ?? RUNTIME_DEFAULT_CHANNEL}.`
    );
  }
  validateBundleMetadata(bundle);
  return bundle;
}

export async function resolveRuntimeBundleByVersion(version: string, currentCliVersion: string): Promise<RuntimeBundle> {
  const manifest = await loadRuntimeManifest();
  const platform = getCurrentPlatform();
  const bundle = manifest.bundles.find((candidate) => candidate.platform === platform && candidate.version === version);
  if (!bundle) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `No runtime bundle ${version} is available for ${platform}.`);
  }
  if (!isRuntimeCompatible(bundle.minimumCliVersion, currentCliVersion)) {
    throw new CliError("RUNTIME_BOOTSTRAP_FAILED", `Runtime bundle ${version} for ${platform} requires CLI >= ${bundle.minimumCliVersion}.`);
  }
  validateBundleMetadata(bundle);
  return bundle;
}
