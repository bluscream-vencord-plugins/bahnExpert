/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const MODES = ["departures", "train"] as const;
export type Mode = typeof MODES[number];

let onRefresh = () => { };
/** status.ts registers its refresh here, so this file doesn't import it back. */
export function onSettingsRefresh(fn: () => void) {
    onRefresh = fn;
}

export const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Write the live status into whichever voice channel you are in. Whatever status the channel had before is put back when you leave or turn this off.",
        default: true,
        onChange: () => onRefresh(),
    },
    interval: {
        type: OptionType.SLIDER,
        description: "Seconds between refreshes. The channel status is only written when the text actually changes.",
        markers: [15, 30, 60, 120, 300],
        default: 30,
        stickToMarkers: false,
        onChange: () => onRefresh(),
    },
    lookahead: {
        type: OptionType.NUMBER,
        description: "How many minutes into the future to look for departures.",
        default: 120,
    },
    emptyText: {
        type: OptionType.STRING,
        description: "Channel status when no departure matches or the train cannot be found.",
        default: "Keine Abfahrten",
    },
}).withPrivateSettings<{
    mode?: Mode;
    station?: string;
    via?: string;
    categories?: string;
    format?: string;
    train?: string;
    /** YYYY-MM-DD, empty for today. */
    trainDate?: string;
    trainFormat?: string;
}>();
