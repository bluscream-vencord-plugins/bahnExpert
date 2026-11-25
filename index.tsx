/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { type Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { Menu } from "@webpack/common";

import { findStation, findTrain, formatTrainDateLabel, nextDepartures, resolveTrainDate } from "./api";
import { CHAT_FORMAT, DEFAULT_TRAIN_FORMAT, formatDeparture, formatTrain } from "./format";
import { BahnExpertError } from "./bahn-expert-ts/src";
import { settings } from "./settings";
import { beforeVoiceChannelSelect, onVoiceStateUpdates, start, stop } from "./status";
import { openStatusModal } from "./StatusModal";

const logger = new Logger("BahnExpert");
const ACTIVE_KEY: "active"[] = ["active"];

function failure(error: unknown): string {
    logger.error("bahn.expert lookup failed", error);
    return error instanceof BahnExpertError
        ? `bahn.expert did not answer: ${error.message}`
        : "Something went wrong while asking bahn.expert.";
}

export default definePlugin({
    name: "BahnExpert",
    description: "Train departures from bahn.expert, as slash commands and as a live voice channel status that follows you.",
    authors: [{ name: "Bluscream", id: 467777925790564352n }, { name: "b1uscr34m", id: 896443818935713853n }],
    settings,

    commands: [
        {
            name: "abfahrten",
            description: "Next departures of a station.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "station", description: "Station name, EVA number or RIL100 code.", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "via", description: "Only departures passing this stop.", type: ApplicationCommandOptionType.STRING },
                { name: "verkehrsmittel", description: "Only these categories, comma separated, such as ICE,RE,S.", type: ApplicationCommandOptionType.STRING },
                { name: "count", description: "How many departures to show. Default 10.", type: ApplicationCommandOptionType.INTEGER },
            ],
            async execute(args, ctx) {
                const term = findOption(args, "station", "");
                const via = findOption(args, "via", "");
                const count = findOption(args, "count", 10);

                try {
                    const place = await findStation(term);
                    if (!place) {
                        sendBotMessage(ctx.channel.id, { content: `No station found for "${term}".` });
                        return;
                    }

                    const categories = findOption(args, "verkehrsmittel", "").split(",").map(c => c.trim()).filter(Boolean);
                    const departures = await nextDepartures(place.evaNumber, { via, categories }, count, settings.store.lookahead);
                    const lines = departures.map(d => formatDeparture(d, CHAT_FORMAT));

                    sendBotMessage(ctx.channel.id, {
                        content: lines.length
                            ? `**${place.name}**${via ? ` via ${via}` : ""}\n${lines.join("\n")}`
                            : `No departures from ${place.name}${via ? ` via ${via}` : ""} in the next ${settings.store.lookahead} minutes.`,
                    });
                } catch (error) {
                    sendBotMessage(ctx.channel.id, { content: failure(error) });
                }
            },
        },
        {
            name: "zug",
            description: "Where a train is right now.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "train", description: "Train such as ICE 702, RE 4711 or just the number.", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "datum", description: "Departure date: 'yesterday', YYYY-MM-DD or empty for today.", type: ApplicationCommandOptionType.STRING },
            ],
            async execute(args, ctx) {
                const train = findOption(args, "train", "");
                const dateStr = findOption(args, "datum", "");
                try {
                    const journey = await findTrain(train, resolveTrainDate(dateStr));
                    sendBotMessage(ctx.channel.id, {
                        content: journey
                            ? `**${journey.train.name}** ${journey.segmentStart.name} → ${journey.finalDestination}\n${formatTrain(journey, DEFAULT_TRAIN_FORMAT)}`
                            : `No train found for "${train}" ${formatTrainDateLabel(dateStr)}.`,
                    });
                } catch (error) {
                    sendBotMessage(ctx.channel.id, { content: failure(error) });
                }
            },
        },
    ],

    contextMenus: {
        "channel-context"(children, { channel }: { channel: Channel; }) {
            if (channel.type !== ChannelType.GUILD_VOICE) return;

            children.push(
                <Menu.MenuGroup>
                    <Menu.MenuCheckboxItem
                        id="vc-bahnexpert-active"
                        label="Bahn Status"
                        checked={settings.store.active}
                        action={() => { settings.store.active = !settings.store.active; }}
                    />
                    <Menu.MenuItem id="vc-bahnexpert-configure" label="Configure Bahn Status" action={() => openStatusModal()} />
                </Menu.MenuGroup>
            );
        },
    },

    toolboxActions() {
        const { active } = settings.use(ACTIVE_KEY);
        return (
            <>
                <Menu.MenuCheckboxItem
                    id="vc-bahnexpert-toolbox-active"
                    label="Bahn Status"
                    checked={active}
                    action={() => { settings.store.active = !active; }}
                />
                <Menu.MenuItem id="vc-bahnexpert-toolbox-configure" label="Configure Bahn Status" action={() => openStatusModal()} />
            </>
        );
    },

    patches: [
        {
            find: 'type:"VOICE_CHANNEL_SHOW_FEEDBACK"',
            replacement: {
                match: /selectVoiceChannel\((\i)\)\{/,
                replace: "async $& await $self.beforeVoiceChannelSelect($1);",
            },
        },
    ],
    beforeVoiceChannelSelect,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: { userId: string; channelId?: string | null; oldChannelId?: string | null; }[]; }) {
            onVoiceStateUpdates(voiceStates);
        },
    },

    start,
    stop,
});
