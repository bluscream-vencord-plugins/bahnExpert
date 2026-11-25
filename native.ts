/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

import { PATTERNS } from "./patterns";

/*
 * bahn.expert only answers requests with a bahn.expert Referer and a browser-like User-Agent and sends no CORS
 * headers, so requests leave from the main process. The procedure and body are renderer controlled and checked here.
 */

const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type NativeResult = { status: number; body: string; } | { error: string; };

export async function call(_: IpcMainInvokeEvent, procedure: unknown, body: unknown): Promise<NativeResult> {
    if (typeof procedure !== "string" || !PATTERNS.bahn.procedure.test(procedure)) {
        return { error: "Invalid procedure." };
    }
    if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BODY_BYTES) {
        return { error: "Invalid request body." };
    }

    try {
        const response = await fetch(PATTERNS.bahn.baseUrl + procedure, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                referer: PATTERNS.bahn.referer,
                "user-agent": PATTERNS.bahn.userAgent,
            },
            body,
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) return { error: "Response too large." };
        if (!response.body) return { status: response.status, body: "" };

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
            size += read.value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                return { error: "Response too large." };
            }
            chunks.push(read.value);
        }
        return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
    } catch {
        return { error: "Could not reach bahn.expert." };
    }
}
