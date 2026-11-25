/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

/*
 * Why this exists: bahn.expert only answers requests that carry a Referer on bahn.expert and a
 * browser-looking User-Agent, and it sends no CORS headers. The renderer can set neither
 * header and is blocked by CORS anyway, so the request has to leave from the main process.
 * Only the procedure path and the already-serialized body cross the IPC boundary; both are
 * renderer controlled and are checked here.
 */

const BASE_URL = "https://bahn.expert/api/orpc/";
const PROCEDURE = /^[a-zA-Z]+\/[a-zA-Z]+$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type NativeResult = { status: number; body: string; } | { error: string; };

export async function call(_: IpcMainInvokeEvent, procedure: unknown, body: unknown): Promise<NativeResult> {
    if (typeof procedure !== "string" || !PROCEDURE.test(procedure)) {
        return { error: "Invalid procedure." };
    }
    if (typeof body !== "string" || body.length > MAX_BODY_BYTES) {
        return { error: "Invalid request body." };
    }

    try {
        const response = await fetch(BASE_URL + procedure, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                referer: "https://bahn.expert/",
                "user-agent": "Mozilla/5.0 (compatible; Equicord BahnExpert)",
            },
            body,
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const length = Number(response.headers.get("content-length") ?? 0);

        if (length > MAX_RESPONSE_BYTES) return { error: "Response too large." };

        return { status: response.status, body: await response.text() };
    } catch {
        return { error: "Could not reach bahn.expert." };
    }
}
