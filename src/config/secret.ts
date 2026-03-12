import fs from "node:fs/promises";
import { chmod600, fileExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { getSecretFallbackPath } from "./paths.js";

const SERVICE_NAME = "manim-cli";

type SecretMap = Record<string, string>;

type KeytarLike = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

async function loadOptionalModule(specifier: string): Promise<unknown> {
  const dynamicImport = new Function("m", "return import(m)") as (moduleName: string) => Promise<unknown>;
  try {
    return await dynamicImport(specifier);
  } catch {
    return null;
  }
}

async function getKeytar(): Promise<KeytarLike | null> {
  try {
    const module = await loadOptionalModule("keytar");
    if (!module || typeof module !== "object") {
      return null;
    }
    const candidate = (module as { default?: unknown }).default ?? module;
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "getPassword" in candidate &&
      "setPassword" in candidate &&
      "deletePassword" in candidate
    ) {
      return candidate as KeytarLike;
    }
    return null;
  } catch {
    return null;
  }
}

async function loadFallbackSecrets(): Promise<SecretMap> {
  const filePath = getSecretFallbackPath();
  if (!(await fileExists(filePath))) {
    return {};
  }
  return readJsonFile<SecretMap>(filePath);
}

async function saveFallbackSecrets(value: SecretMap): Promise<void> {
  const filePath = getSecretFallbackPath();
  await writeJsonFile(filePath, value);
  await chmod600(filePath);
}

export async function getSecret(account: string): Promise<string | null> {
  if (account === "openai_api_key" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  const keytar = await getKeytar();
  if (keytar) {
    const secret = await keytar.getPassword(SERVICE_NAME, account);
    if (secret) {
      return secret;
    }
  }

  const fallback = await loadFallbackSecrets();
  return fallback[account] ?? null;
}

export async function setSecret(account: string, value: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, account, value);
    return;
  }
  const fallback = await loadFallbackSecrets();
  fallback[account] = value;
  await saveFallbackSecrets(fallback);
}

export async function deleteSecret(account: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, account);
  }
  const fallback = await loadFallbackSecrets();
  delete fallback[account];
  await saveFallbackSecrets(fallback);
}

export async function promptHidden(promptText: string): Promise<string> {
  process.stdout.write(promptText);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: string) => {
      const character = chunk.toString();
      if (character === "\n" || character === "\r" || character === "\u0004") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buffer.trim());
        return;
      }
      if (character === "\u0003") {
        process.exit(1);
      }
      buffer += character;
    };
    process.stdin.on("data", onData);
  });
}
