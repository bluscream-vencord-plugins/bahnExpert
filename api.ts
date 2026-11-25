/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { escapeRegExp } from "@utils/text";
import { type PluginNative } from "@utils/types";

import { type Abfahrt, BahnExpert, type JourneyDetails, type StopPlace } from "./bahn-expert-ts/src";

const Native = VencordNative.pluginHelpers.BahnExpert as PluginNative<typeof import("./native")>;

const ORPC_MARKER = "/api/orpc/";

const nativeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const procedure = url.slice(url.indexOf(ORPC_MARKER) + ORPC_MARKER.length);
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

/**
 * The product categories currently on a station's board, for the filter UI. IRIS leaves
 * `train.transportType` empty, so `category` (`ICE`, `RE`, `S`, `Bus`) is the only thing that
 * actually describes the Verkehrsmittel.
 */
export async function boardCategories(evaNumber: string, lookahead: number): Promise<string[]> {
    const board = await bahn.iris.departures({ evaNumber, lookahead });
    const categories = new Set(board.departures.filter(d => d.departure).map(d => d.train.category));
    return [...categories].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function passesThrough(abfahrt: Abfahrt, via: string): boolean {
    const word = new RegExp(`(^|[\\s\\-(/,])${escapeRegExp(via)}(?=$|[\\s\\-)/,])`, "i");
    const current = abfahrt.route.findIndex(stop => stop.name === abfahrt.currentStopPlace.name);
    const ahead = abfahrt.route.slice(current + 1);
    return word.test(abfahrt.destination) || ahead.some(stop => !stop.cancelled && word.test(stop.name));
}

/**
 * Formats a Date to a local "YYYY-MM-DD" string.
 */
export function toLocalDateString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Returns yesterday's local "YYYY-MM-DD" string.
 */
export function getYesterdayString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalDateString(d);
}

/**
 * Resolves a date string ("yesterday", "today", "", or "YYYY-MM-DD") to a Date object at midday,
 * or undefined when empty or "today" so bahn.expert uses the current time.
 */
export function resolveTrainDate(dateStr?: string): Date | undefined {
    if (!dateStr || dateStr === "today") return undefined;
    if (dateStr === "yesterday") {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setHours(12, 0, 0, 0);
        return d;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!match) return undefined;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Friendly label for user-facing toasts and messages.
 */
export function formatTrainDateLabel(dateStr?: string): string {
    if (!dateStr || dateStr === "today") return "today";
    if (dateStr === "yesterday") return "yesterday";
    const today = toLocalDateString();
    if (dateStr === today) return "today";
    const yesterday = getYesterdayString();
    if (dateStr === yesterday) return "yesterday";
    return `on ${dateStr}`;
}

/**
 * A train's run, given as `ICE 702`, `S1 38123` or just `702`, optionally on a specific date.
 * A journey number alone can belong to several trains across Europe, so a category narrows it
 * down when given.
 */
export async function findTrain(input: string, date?: Date): Promise<JourneyDetails | null> {
    const match = /^(?:([a-zA-Z]+)\s*)?(\d+)$/.exec(input.trim());
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
