/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { escapeRegExp } from "@utils/text";
import { type PluginNative } from "@utils/types";

import { type Abfahrt, BahnExpert, type JourneyDetails, type StopPlace } from "./bahn-expert-ts/src";
import { PATTERNS } from "./patterns";

const Native = VencordNative.pluginHelpers.BahnExpert as PluginNative<typeof import("./native")>;
const { today: TODAY, yesterday: YESTERDAY } = PATTERNS.dateKeywords;

const nativeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const procedure = url.slice(url.indexOf(PATTERNS.bahn.orpcMarker) + PATTERNS.bahn.orpcMarker.length);
    const result = await Native.call(procedure, String(init?.body ?? ""));

    if ("error" in result) throw new Error(result.error);

    return new Response(result.body, { status: result.status });
};

export const bahn = new BahnExpert({ fetch: nativeFetch });

export async function findStation(term: string): Promise<StopPlace | null> {
    const [place] = await bahn.stopPlace.byTerm({ searchTerm: term, max: 1, filterForIris: true });
    return place ?? null;
}

export interface DepartureFilter {
    via: string;
    /** Product categories to keep, as `train.category` reports them. Empty keeps every category. */
    categories: string[];
}

export async function nextDepartures(evaNumber: string, filter: DepartureFilter, count: number, lookahead: number): Promise<Abfahrt[]> {
    const board = await bahn.iris.departures({ evaNumber, lookahead });
    let departures = board.departures.filter(d => d.departure);

    if (filter.via) departures = departures.filter(d => passesThrough(d, filter.via));
    if (filter.categories.length) {
        const wanted = new Set(filter.categories.map(c => c.toLowerCase()));
        departures = departures.filter(d => wanted.has(d.train.category.toLowerCase()));
    }

    return departures.slice(0, count);
}

/** The product categories on a station's board. IRIS leaves `transportType` empty, so `category` is used. */
export async function boardCategories(evaNumber: string, lookahead: number): Promise<string[]> {
    const board = await bahn.iris.departures({ evaNumber, lookahead });
    const categories = new Set(board.departures.filter(d => d.departure).map(d => d.train.category));
    return [...categories].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function passesThrough(abfahrt: Abfahrt, via: string): boolean {
    const word = PATTERNS.viaWord(escapeRegExp(via));
    const current = abfahrt.route.findIndex(stop => stop.name === abfahrt.currentStopPlace.name);
    const ahead = abfahrt.route.slice(current + 1);
    return word.test(abfahrt.destination) || ahead.some(stop => !stop.cancelled && word.test(stop.name));
}

/** A local "YYYY-MM-DD" string. */
export function toLocalDateString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function getYesterdayString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalDateString(d);
}

/** "yesterday", "today", "" or "YYYY-MM-DD" as a Date at midday, or undefined for today so bahn.expert uses the current time. */
export function resolveTrainDate(dateStr?: string): Date | undefined {
    if (!dateStr || dateStr === TODAY) return undefined;
    if (dateStr === YESTERDAY) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setHours(12, 0, 0, 0);
        return d;
    }
    const match = PATTERNS.isoDate.exec(dateStr.trim());
    if (!match) return undefined;
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
}

export function formatTrainDateLabel(dateStr?: string): string {
    if (!dateStr || dateStr === TODAY || dateStr === toLocalDateString()) return TODAY;
    if (dateStr === YESTERDAY || dateStr === getYesterdayString()) return YESTERDAY;
    return `on ${dateStr}`;
}

/** A train's run, given as `ICE 702`, `S1 38123` or just `702`. A number alone can match several trains, so a category narrows it down. */
export async function findTrain(input: string, date?: Date): Promise<JourneyDetails | null> {
    const match = PATTERNS.trainInput.exec(input.trim());
    if (!match) return null;
    const [, category, number] = match;

    const found = await bahn.journey.find({
        journeyNumber: Number(number),
        category: category || undefined,
        initialDepartureDate: date,
        limit: 5,
        withOEV: true,
    });
    const journey = category
        ? found.find(j => j.train.category.toLowerCase() === category.toLowerCase())
        : found[0];
    return journey ? bahn.journey.detailsByJourneyId(journey.journeyId) : null;
}
