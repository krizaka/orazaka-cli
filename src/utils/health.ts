/**
 * @file health.ts
 * @description Network health primitives shared by every command/service that
 * probes a port or HTTP endpoint (start, stop, status, doctor, recover,
 * diagnostics). Centralized so the TCP/HTTP probing logic exists exactly once.
 */

import * as net from "node:net";
import * as http from "node:http";
import { TIMEOUTS } from "./config";

/** Checks if a port is available (i.e. NOT in use). */
export function checkPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUTS.portProbeMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // in use
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true); // available
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.connect(port, host);
  });
}

/** True when a service is listening on the port (inverse of availability). */
export async function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return !(await checkPortAvailable(port, host));
}

/** Checks if an HTTP endpoint responds with a non-server-error status. */
export function checkHttpEndpoint(url: string, timeout = TIMEOUTS.httpTimeoutMs): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      resolve(res.statusCode ? res.statusCode >= 200 && res.statusCode < 500 : false);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Polls until a service is listening on the port, or the retry budget runs out. */
export async function waitForPort(
  port: number,
  maxRetries = TIMEOUTS.healthRetries,
  intervalMs = TIMEOUTS.healthIntervalMs,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await isPortInUse(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
