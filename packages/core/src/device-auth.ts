import { authHeaders, registryUrl } from "./registry.ts";

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
}

interface TokenPollResponse {
  status: "pending" | "approved" | "denied" | "expired";
  token?: string;
  name?: string;
}

export async function startDeviceAuthorization(opts: {
  registry?: string;
  hostname?: string;
} = {}): Promise<DeviceAuthorization> {
  const res = await fetch(`${registryUrl(opts.registry)}/v1/cli/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hostname: opts.hostname }),
  });

  if (!res.ok) {
    throw new Error(`Device authorization failed (${res.status}): ${await res.text()}`);
  }

  return (await res.json()) as DeviceAuthorization;
}

export async function pollDeviceToken(opts: {
  registry?: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  onPoll?: (status: TokenPollResponse["status"]) => void | Promise<void>;
}): Promise<string> {
  const started = Date.now();
  const expiresAt = started + opts.expiresInSeconds * 1000;
  const intervalMs = Math.max(1, opts.intervalSeconds) * 1000;

  while (Date.now() < expiresAt) {
    const res = await fetch(`${registryUrl(opts.registry)}/v1/cli/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: opts.deviceCode }),
    });

    if (res.status === 404) {
      throw new Error("Device authorization was not found or has expired.");
    }
    if (!res.ok) {
      throw new Error(`Device token polling failed (${res.status}): ${await res.text()}`);
    }

    const body = (await res.json()) as TokenPollResponse;
    await opts.onPoll?.(body.status);

    if (body.status === "approved") {
      if (!body.token) throw new Error("Device authorization was approved, but no token was returned.");
      return body.token;
    }
    if (body.status === "denied") {
      throw new Error("Device authorization was denied.");
    }
    if (body.status === "expired") {
      throw new Error("Device authorization expired before approval.");
    }
    if (body.status !== "pending") {
      throw new Error(`Unexpected device authorization status: ${String(body.status)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, expiresAt - Date.now())));
  }

  throw new Error("Timed out waiting for device authorization approval.");
}

export async function revokeCurrentToken(opts: {
  registry?: string;
  token?: string;
} = {}): Promise<void> {
  const res = await fetch(`${registryUrl(opts.registry)}/v1/tokens/current`, {
    method: "DELETE",
    headers: authHeaders(opts.token),
  });

  if (!res.ok) {
    throw new Error(`Token revoke failed (${res.status}): ${await res.text()}`);
  }
}
