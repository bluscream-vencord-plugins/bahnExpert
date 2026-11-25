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
import { ChannelActions, ChannelStore, PermissionsBits, PermissionStore, UserStore, VoiceStateStore } from "@webpack/common";

import { findStation, findTrain, nextDepartures, resolveTrainDate } from "./api";
import { DEFAULT_STATUS_FORMAT, DEFAULT_TRAIN_FORMAT, formatDeparture, formatTrain } from "./format";
import { PATTERNS } from "./patterns";
import { onSettingsRefresh, settings } from "./settings";

/** The channel whose status this plugin holds, and what to put back when it lets go. */
interface Owned {
    channelId: string;
    lastWritten: string;
    backup: string;
}

const STORE_KEY = "BahnExpert_owned";
const MAX_STATUS_LENGTH = 500;
/** The longest a leave or switch waits for the old status to be put back. */
const LEAVE_WAIT_MS = 1000;
/** The longest delay setTimeout accepts; anything longer fires immediately instead. */
const MAX_TIMEOUT = 2 ** 31 - 1;
const logger = new Logger("BahnExpert");

const ChannelSettingsActions = findByPropsLazy(...PATTERNS.webpack.channelSettingsActions) as {
    updateVoiceChannelStatus(channelId: string, status: string): Promise<{ status: number; }>;
};
const ChannelStatusStore = findStoreLazy(PATTERNS.webpack.channelStatusStore) as {
    getChannelStatus(channel: Channel): string | undefined;
    hasRequestedStatuses(guildId: string): boolean;
};
const requestChannelStatuses = findByCodeLazy(...PATTERNS.webpack.requestChannelStatuses) as (guildId: string) => void;

let owned: Owned | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Failed updates in a row; each one doubles the wait before the next. */
let failures = 0;
let running = false;
/** Bumped whenever the status is let go, so an update still in flight drops its result. */
let generation = 0;
let queue = Promise.resolve();
let stationCache: { term: string; evaNumber: string; } | undefined;
let deferredSelect: unknown[] | undefined;
let bypassSelect = false;

function persist() {
    DataStore.set(STORE_KEY, owned).catch(error => logger.warn("Could not save the status backup", error));
}

/** Undefined until Discord has loaded the statuses of that server. */
function currentStatus(channel: Channel): string | undefined {
    if (!ChannelStatusStore.hasRequestedStatuses(channel.guild_id)) {
        requestChannelStatuses(channel.guild_id);
        return undefined;
    }
    return ChannelStatusStore.getChannelStatus(channel) ?? "";
}

function myVoiceChannel(): Channel | undefined {
    const channelId = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id)?.channelId;
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    const writable = channel?.type === ChannelType.GUILD_VOICE && PermissionStore.can(PermissionsBits.SET_VOICE_CHANNEL_STATUS, channel);
    return writable ? channel : undefined;
}

async function release() {
    generation++;
    const held = owned;
    if (!held) return;
    const channel = ChannelStore.getChannel(held.channelId);
    try {
        if (channel && currentStatus(channel) !== held.backup)
            await ChannelSettingsActions.updateVoiceChannelStatus(held.channelId, held.backup);
        if (channel) logger.info(held.backup ? `Restored the previous status of ${channel.name}` : `Cleared the status of ${channel.name}`);
    } catch (error) {
        logger.warn(`Could not restore the status of ${channel?.name ?? held.channelId}`, error);
        if (myVoiceChannel()?.id === held.channelId) return;
    }
    if (owned === held) {
        owned = undefined;
        persist();
    }
}

async function compose(): Promise<string | undefined> {
    const { mode, station = "", via = "", categories = "", format, train = "", trainDate, trainFormat, lookahead, emptyText } = settings.store;

    if (mode === "train") {
        if (!train.trim()) return;
        const journey = await findTrain(train, resolveTrainDate(trainDate));
        return journey ? formatTrain(journey, trainFormat || DEFAULT_TRAIN_FORMAT) || emptyText : emptyText;
    }

    if (!station.trim()) return;
    if (stationCache?.term !== station) {
        const place = await findStation(station);
        if (!place) return emptyText;
        stationCache = { term: station, evaNumber: place.evaNumber };
    }
    const filter = { via, categories: categories.split(",").map(c => c.trim()).filter(Boolean) };
    const [departure] = await nextDepartures(stationCache.evaNumber, filter, 1, lookahead);
    return departure ? formatDeparture(departure, format || DEFAULT_STATUS_FORMAT) : emptyText;
}

/** Updates the status once. Returns false when fetching or writing it failed, so the next try waits longer. */
async function tick(): Promise<boolean> {
    const channel = settings.store.active ? myVoiceChannel() : undefined;
    if (!channel) {
        await release();
        return true;
    }
    if (owned && owned.channelId !== channel.id) await release();

    const startedIn = generation;
    const stale = () => startedIn !== generation || !running || myVoiceChannel()?.id !== channel.id;
    try {
        const status = (await compose())?.slice(0, MAX_STATUS_LENGTH);
        if (stale()) return true;
        if (status === undefined) {
            await release();
            return true;
        }

        // Discord clears a status once the channel empties and others can edit it, so anything neither empty nor ours is kept as the backup.
        const current = currentStatus(channel);
        if (current === undefined) return true;
        if (!owned) owned = { channelId: channel.id, lastWritten: "", backup: current };
        else if (current && current !== owned.lastWritten) owned.backup = current;
        if (status === current) return true;

        const held = owned;
        const previous = held.lastWritten;
        held.lastWritten = status;
        try {
            await ChannelSettingsActions.updateVoiceChannelStatus(channel.id, status);
        } catch (error) {
            held.lastWritten = previous;
            throw error;
        }
        if (owned === held) persist();
        return true;
    } catch (error) {
        logger.warn("Status update failed", error);
        return false;
    }
}

function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (!running) return;
    // After failures the wait doubles each time with no upper limit, and goes back to the interval after a success.
    const delay = Math.min(settings.store.interval * 1000 * 2 ** failures, MAX_TIMEOUT);
    timer = setTimeout(refresh, delay);
}

/** Runs one update after any that is still going, then schedules the next one. Every trigger goes through here. */
export function refresh(): Promise<void> {
    queue = queue
        .then(tick)
        .catch(error => {
            logger.warn("Status update failed", error);
            return false;
        })
        .then(ok => {
            failures = ok ? 0 : failures + 1;
            schedule();
        });
    return queue;
}

onSettingsRefresh(refresh);

/**
 * Called first thing in Discord's selectVoiceChannel. While the plugin holds the status of the channel being
 * left, the call is held back for at most a second so the old status can be put back while the server still
 * counts us as connected, then the latest held call is replayed. Returns true when the call was held back.
 */
export function deferVoiceChannelSelect(args: IArguments): boolean {
    if (bypassSelect || !owned || owned.channelId === args[0]) return false;
    const first = deferredSelect === undefined;
    deferredSelect = Array.from(args);
    if (first) {
        Promise.race([release(), sleep(LEAVE_WAIT_MS)])
            .catch(error => logger.warn("Could not restore the status before leaving", error))
            .finally(() => {
                const call = deferredSelect;
                deferredSelect = undefined;
                if (!call) return;
                bypassSelect = true;
                try {
                    ChannelActions.selectVoiceChannel(...(call as Parameters<typeof ChannelActions.selectVoiceChannel>));
                } finally {
                    bypassSelect = false;
                }
            });
    }
    return true;
}

export function onVoiceStateUpdates(voiceStates: { userId: string; channelId?: string | null; oldChannelId?: string | null; }[]) {
    const me = UserStore.getCurrentUser().id;
    if (voiceStates.some(s => s.userId === me && s.channelId !== s.oldChannelId)) return refresh();
}

export async function start() {
    running = true;
    const startedIn = ++generation;
    try {
        const stored = await DataStore.get<Owned>(STORE_KEY);
        if (!running || startedIn !== generation) return;
        owned = stored;
    } catch (error) {
        logger.warn("Could not load the status backup", error);
    }
    if (running) refresh();
}

export function stop() {
    running = false;
    clearTimeout(timer);
    timer = undefined;
    release().catch(error => logger.warn("Could not restore the status", error));
}
