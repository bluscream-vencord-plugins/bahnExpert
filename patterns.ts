/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Every string, regex and id this plugin matches against or relies on. */
export const PATTERNS = {
    /** Discord's voice channel actions module and its selectVoiceChannel method. */
    voiceSelect: {
        find: 'type:"VOICE_CHANNEL_SHOW_FEEDBACK"',
        match: /selectVoiceChannel\(\i\)\{/
    },
    webpack: {
        channelSettingsActions: ["updateVoiceChannelStatus", "updateChannel"],
        channelStatusStore: "ChannelStatusStore",
        requestChannelStatuses: ['type:"FETCH_CHANNEL_INFO"', "requestChannelInfo("]
    },
    bahn: {
        /** Requests the library makes go to <origin>/api/orpc/<procedure>. */
        orpcMarker: "/api/orpc/",
        baseUrl: "https://bahn.expert/api/orpc/",
        referer: "https://bahn.expert/",
        userAgent: "Mozilla/5.0 (compatible; Equicord BahnExpert)",
        procedure: /^[a-zA-Z]+\/[a-zA-Z]+$/
    },
    /** "ICE 702", "S1 38123" or "702". */
    trainInput: /^(?:([a-zA-Z]+)\s*)?(\d+)$/,
    isoDate: /^(\d{4})-(\d{2})-(\d{2})$/,
    /** A stop name, already regex escaped, as a whole word inside a station or destination name. */
    viaWord: (escapedVia: string) => new RegExp(`(^|[\\s(/,-])${escapedVia}(?=$|[\\s)/,-])`, "i"),
    placeholder: /\{(\w+)\}/g,
    dateKeywords: { today: "today", yesterday: "yesterday" },
    menuIds: {
        active: "vc-bahnexpert-active",
        configure: "vc-bahnexpert-configure",
        toolboxActive: "vc-bahnexpert-toolbox-active",
        toolboxConfigure: "vc-bahnexpert-toolbox-configure"
    }
} as const;
