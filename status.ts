/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { type Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findByCodeLazy, findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, PermissionsBits, PermissionStore, UserStore, VoiceStateStore } from "@webpack/common";

import { findStation, findTrain, nextDepartures, resolveTrainDate } from "./api";
import { formatDeparture, formatTrain } from "./format";
import { settings } from "./settings";

/** The channel whose status this plugin currently holds, and what to put back when it lets go. */
interface Owned {
    channelId: string;
    lastWritten: string;
    backup: string;
}

const STORE_KEY = "BahnExpert_owned";
const MAX_STATUS_LENGTH = 500;
const logger = new Logger("BahnExpert");

const ChannelSettingsActions = findByPropsLazy("updateVoiceChannelStatus", "updateChannel") as {
    updateVoiceChannelStatus(channelId: string, status: string): Promise<{ status: number; }>;
};
const ChannelStatusStore = findStoreLazy("ChannelStatusStore") as {
    getChannelStatus(channel: Channel): string | undefined;
    hasRequestedStatuses(guildId: string): boolean;
};
const requestChannelStatuses = findByCodeLazy('type:"FETCH_CHANNEL_INFO"', "requestChannelInfo(") as (guildId: string) => void;

let owned: Owned | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Updates that failed in a row; each one doubles the wait before the next. */
let failures = 0;
/** False after stop(), so an update that was still running doesn't schedule another one. */
let running = false;
let stationCache: { term: string; evaNumber: string; } | undefined;

function persist() {
    return DataStore.set(STORE_KEY, owned);
}

function currentStatus(channel: Channel): string {
    if (!ChannelStatusStore.hasRequestedStatuses(channel.guild_id)) requestChannelStatuses(channel.guild_id);
    return ChannelStatusStore.getChannelStatus(channel) ?? "";
}

function myVoiceChannel(): Channel | undefined {
    const channelId = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)?.channelId;
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    const writable = channel?.type === ChannelType.GUILD_VOICE && PermissionStore.can(PermissionsBits.SET_VOICE_CHANNEL_STATUS, channel);
    return writable ? channel : undefined;
}

async function release() {
    if (!owned) return;
    const { channelId, backup } = owned;
    owned = undefined;
    await persist();

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;
    try {
        if (currentStatus(channel) !== backup) await ChannelSettingsActions.updateVoiceChannelStatus(channelId, backup);
        logger.info(backup ? `Restored the previous status of ${channel.name}` : `Cleared the status of ${channel.name}`);
    } catch (error) {
        logger.warn(`Could not restore the status of ${channel.name}`, error);
    }
}

/** The status text for the current configuration, or undefined while nothing is configured. */
async function compose(): Promise<string | undefined> {
    const { mode, station, via, categories, format, train, trainDate, trainFormat, lookahead, emptyText } = settings.store;

    if (mode === "train") {
        if (!train.trim()) return;
        const journey = await findTrain(train, resolveTrainDate(trainDate));
        return journey ? formatTrain(journey, trainFormat) || emptyText : emptyText;
    }

    if (!station.trim()) return;
    if (stationCache?.term !== station) {
        const place = await findStation(station);
        if (!place) return emptyText;
        stationCache = { term: station, evaNumber: place.evaNumber };
    }
    const filter = { via, categories: categories.split(",").map(c => c.trim()).filter(Boolean) };
    const [departure] = await nextDepartures(stationCache.evaNumber, filter, 1, lookahead);
    return departure ? formatDeparture(departure, format) : emptyText;
}

/** Updates the status once. Returns false when fetching or writing it failed, so the next try waits longer. */
export async function tick(): Promise<boolean> {
    const channel = settings.store.active ? myVoiceChannel() : undefined;
    if (!channel) {
        await release();
        return true;
    }
    if (owned && owned.channelId !== channel.id) await release();

    try {
        const status = (await compose())?.slice(0, MAX_STATUS_LENGTH);
        if (status === undefined) {
            await release();
            return true;
        }

        /*
         * Compare against what Discord holds, not memory alone. Discord clears a status by itself
         * once the channel empties, and other people can edit it. Anything that is neither empty nor
         * our own last write was set by someone else and is kept for later.
         */
        const current = currentStatus(channel);
        if (!owned) owned = { channelId: channel.id, lastWritten: "", backup: current };
        else if (current && current !== owned.lastWritten) owned.backup = current;

        if (status !== current) await ChannelSettingsActions.updateVoiceChannelStatus(channel.id, status);
        owned.lastWritten = status;
        await persist();
        return true;
    } catch (error) {
        logger.warn("Status update failed", error);
        return false;
    }
}

/*
 * Runs inside Discord's own selectVoiceChannel before the leave or switch goes out, while the
 * server still counts us as connected and therefore still accepts the status write. Server side
 * disconnects skip this path and fall back to the flux handler below.
 */
export async function beforeVoiceChannelSelect(channelId: string | null) {
    if (!owned || owned.channelId === channelId) return;
    try {
        await Promise.race([release(), sleep(3000)]);
    } catch (error) {
        logger.warn("Could not restore the status before leaving", error);
    }
}

export function onVoiceStateUpdates(voiceStates: { userId: string; channelId?: string | null; oldChannelId?: string | null; }[]) {
    const me = UserStore.getCurrentUser().id;
    if (voiceStates.some(s => s.userId === me && s.channelId !== s.oldChannelId)) tick();
}

/** The longest delay setTimeout accepts; anything longer fires immediately instead. */
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Waits the configured interval between updates. After failures (the Bahn API or Discord not answering) the wait
 * doubles each time with no upper limit, and goes back to the interval after a success.
 */
function nextDelay() {
    return Math.min(settings.store.interval * 1000 * 2 ** failures, MAX_TIMEOUT);
}

function schedule() {
    if (!running) return;
    timer = setTimeout(async () => {
        failures = await tick() ? 0 : failures + 1;
        schedule();
    }, nextDelay());
}

export async function start() {
    running = true;
    owned = await DataStore.get<Owned>(STORE_KEY);
    failures = await tick() ? 0 : 1;
    schedule();
}

export function stop() {
    running = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    release();
}
