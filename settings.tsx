/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { OptionType } from "@utils/types";

import { DEFAULT_STATUS_FORMAT, DEFAULT_TRAIN_FORMAT } from "./format";
import { tick } from "./status";
import { openStatusModal } from "./StatusModal";

export const MODES = ["departures", "train"] as const;
export type Mode = typeof MODES[number];

export const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Write the live status into whichever voice channel you are in. Whatever status the channel had before is put back when you leave or turn this off.",
        default: true,
        onChange: () => tick(),
    },
    configure: {
        type: OptionType.COMPONENT,
        component: () => <Button onClick={() => openStatusModal()}>Configure the status text</Button>,
    },
    mode: {
        type: OptionType.STRING,
        description: "Either departures from a station or following one train.",
        default: "departures" satisfies Mode,
        hidden: true,
    },
    station: { type: OptionType.STRING, description: "Station for departures mode.", default: "", hidden: true },
    via: { type: OptionType.STRING, description: "Only departures passing this stop.", default: "", hidden: true },
    categories: { type: OptionType.STRING, description: "Comma separated product categories to keep.", default: "", hidden: true },
    format: { type: OptionType.STRING, description: "Format of one departure.", default: DEFAULT_STATUS_FORMAT, hidden: true },
    train: { type: OptionType.STRING, description: "Train to follow, such as ICE 702.", default: "", hidden: true },
    trainDate: { type: OptionType.STRING, description: "Departure date for the train (today, yesterday, or YYYY-MM-DD).", default: "", hidden: true },
    trainFormat: { type: OptionType.STRING, description: "Format of the train status.", default: DEFAULT_TRAIN_FORMAT, hidden: true },
    interval: {
        type: OptionType.SLIDER,
        description: "Seconds between refreshes. The channel status is only written when the text actually changes.",
        markers: [15, 30, 60, 120, 300],
        default: 30,
        stickToMarkers: false,
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
});
