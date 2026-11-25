/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { moment } from "@webpack/common";

import { type Abfahrt, type CommonStopInfo, type JourneyDetails } from "./bahn-expert-ts/src";
import { PATTERNS } from "./patterns";

export const PLACEHOLDERS = {
    station: "The station the board belongs to",
    time: "Expected departure, HH:mm",
    scheduled: "Scheduled departure, HH:mm",
    rel: "Relative time, in 5m or now",
    relShort: "Relative time without the words, 5m",
    line: "Full product label, ICE 106 or S1",
    cat: "Category on its own, ICE, RE, S or Bus",
    nr: "Journey number, 106",
    lineNr: "Line label, S1 or RE7, empty when the product has no line",
    dest: "Destination",
    next: "Next stop after this one",
    platform: "Best known platform",
    schedPlatform: "Scheduled platform",
    delay: "Signed delay, +5, empty when on time",
    delayMin: "Delay in minutes as a bare number, empty when on time",
    cancelled: "Reads fällt aus when the stop is cancelled, else empty",
    platformChange: "Reads Gl. 7 when the platform moved, else empty",
    extra: "Delay, cancellation and platform change combined in brackets",
} as const;

export const TRAIN_PLACEHOLDERS = {
    rel: "Time until the train reaches or leaves the next stop, in 5m or now",
    relShort: "The same without the words, 5m",
    time: "Expected time at the next stop, HH:mm",
    scheduled: "Scheduled time at the next stop, HH:mm",
    delay: "Signed delay, +5, empty when on time",
    delayMin: "Delay in minutes as a bare number, empty when on time",
    line: "Train name, ICE 702 or S1",
    cat: "Category on its own, ICE, RE, S",
    nr: "Journey number, 702",
    origin: "Where the train started",
    nextStop: "The stop the train is heading to or standing at",
    stopTrack: "Platform at that stop",
    schedTrack: "Scheduled platform at that stop",
    after: "The stop after the next one",
    dest: "Final destination of the train",
    cancelled: "Reads fällt aus when the stop is cancelled, else empty",
    platformChange: "Reads Gl. 7 when the platform moved, else empty",
    extra: "Delay, cancellation and platform change combined in brackets",
} as const;

export const DEFAULT_STATUS_FORMAT = "{rel} {line} → {dest}{extra}";
export const DEFAULT_TRAIN_FORMAT = "[{rel}{delay}] {nextStop} Gl. {stopTrack} → {dest}";
export const CHAT_FORMAT = "`{time}` **{line}** → {dest}{extra}";

function relative(time: Date, withWords: boolean): string {
    const minutes = Math.round((time.getTime() - Date.now()) / 60_000);
    if (minutes <= 0) return withWords ? "now" : "0m";
    const text = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return withWords ? `in ${text}` : text;
}

function fill(format: string, values: Record<string, string>): string {
    return format.replace(PATTERNS.placeholder, (match, key: string) => Object.hasOwn(values, key) ? values[key] : match);
}

function stopExtras(info: CommonStopInfo, cancelledStop: boolean | undefined) {
    const delay = info.delay ?? 0;
    const isCancelled = Boolean(info.cancelled || cancelledStop);
    const movedPlatform = Boolean(info.platform && info.scheduledPlatform && info.platform !== info.scheduledPlatform);
    const cancelled = isCancelled ? "fällt aus" : "";
    const platformChange = movedPlatform ? `Gl. ${info.platform}` : "";
    const signedDelay = delay !== 0 ? `${delay > 0 ? "+" : ""}${delay}` : "";
    const extras = isCancelled ? [cancelled] : [signedDelay, platformChange].filter(Boolean);
    return {
        time: moment(info.time).format("HH:mm"),
        scheduled: moment(info.scheduledTime).format("HH:mm"),
        rel: relative(info.time, true),
        relShort: relative(info.time, false),
        delay: signedDelay,
        delayMin: delay !== 0 ? String(delay) : "",
        cancelled,
        platformChange,
        extra: extras.length ? ` (${extras.join(", ")})` : "",
    };
}

export function formatDeparture(abfahrt: Abfahrt, format: string): string {
    const dep = abfahrt.departure;
    if (!dep) return "";

    const current = abfahrt.route.findIndex(stop => stop.name === abfahrt.currentStopPlace.name);

    return fill(format, {
        ...stopExtras(dep, abfahrt.cancelled),
        station: abfahrt.currentStopPlace.name,
        line: abfahrt.train.name,
        cat: abfahrt.train.category,
        nr: String(abfahrt.train.journeyNumber),
        lineNr: abfahrt.train.line ?? "",
        dest: abfahrt.destination,
        next: abfahrt.route[current + 1]?.name ?? "",
        platform: dep.platform ?? "",
        schedPlatform: dep.scheduledPlatform ?? "",
    });
}

/*
 * Reports the stop bahn.expert marks as current, else the next stop still ahead, else the final stop.
 * While standing at a stop the departure time matters, otherwise the arrival.
 */
export function formatTrain(journey: JourneyDetails, format: string): string {
    const { stops } = journey;
    if (!stops.length) return "";
    const now = Date.now();
    const found = journey.currentStop
        ? stops.findIndex(s => s.stopPlace.evaNumber === journey.currentStop?.stopPlace.evaNumber)
        : stops.findIndex(s => ((s.departure ?? s.arrival)?.time.getTime() ?? 0) > now);
    const index = found === -1 ? stops.length - 1 : found;
    const stop = stops[index];
    const arrived = stop.arrival && stop.arrival.time.getTime() <= now;
    const info = (arrived ? stop.departure ?? stop.arrival : stop.arrival ?? stop.departure);
    if (!info) return "";

    return fill(format, {
        ...stopExtras(info, stop.cancelled),
        line: journey.train.name,
        cat: journey.train.category,
        nr: String(journey.train.journeyNumber),
        origin: journey.segmentStart.name,
        nextStop: stop.stopPlace.name,
        stopTrack: info.platform ?? "",
        schedTrack: info.scheduledPlatform ?? "",
        after: stops[index + 1]?.stopPlace.name ?? "",
        dest: journey.finalDestination,
    });
}
