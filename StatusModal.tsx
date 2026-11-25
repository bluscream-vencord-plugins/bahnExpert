/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { type RenderModalProps } from "@vencord/discord-types";
import { Checkbox, Modal, openModal, Select, showToast, TextInput, Tooltip, useRef, useState } from "@webpack/common";

import { boardCategories, findStation, findTrain, formatTrainDateLabel, getYesterdayString, resolveTrainDate, toLocalDateString } from "./api";
import { DEFAULT_STATUS_FORMAT, DEFAULT_TRAIN_FORMAT, PLACEHOLDERS, TRAIN_PLACEHOLDERS } from "./format";
import { PATTERNS } from "./patterns";
import { type Mode, settings } from "./settings";
import { refresh } from "./status";

const cl = classNameFactory("vc-bahnexpert-");
const { today: TODAY, yesterday: YESTERDAY } = PATTERNS.dateKeywords;

const MODE_OPTIONS = [
    { label: "Departures from a station", value: "departures" },
    { label: "Follow a train", value: "train" },
] satisfies { label: string; value: Mode; }[];

interface FormatFieldProps {
    value: string;
    placeholders: Record<string, string>;
    onChange(value: string): void;
}

function FormatField({ value, placeholders, onChange }: FormatFieldProps) {
    const input = useRef<HTMLInputElement>(null);

    function insert(key: string) {
        const token = `{${key}}`;
        const start = input.current?.selectionStart ?? value.length;
        const end = input.current?.selectionEnd ?? value.length;
        onChange(value.slice(0, start) + token + value.slice(end));
        requestAnimationFrame(() => {
            input.current?.focus();
            input.current?.setSelectionRange(start + token.length, start + token.length);
        });
    }

    return (
        <section className={Margins.bottom16}>
            <Heading tag="h5">Format</Heading>
            <TextInput value={value} onChange={onChange} inputRef={input} />
            <Paragraph className={Margins.top8}>Click a placeholder to insert it at the cursor. Hover for what it means.</Paragraph>
            <div className={cl("placeholders")}>
                {Object.entries(placeholders).map(([key, help]) => (
                    <Tooltip key={key} text={help}>
                        {({ onMouseEnter, onMouseLeave }) => (
                            <Button
                                type="button"
                                variant="secondary"
                                size="xs"
                                className={cl("placeholder")}
                                onMouseEnter={onMouseEnter}
                                onMouseLeave={onMouseLeave}
                                onClick={() => insert(key)}
                            >
                                {`{${key}}`}
                            </Button>
                        )}
                    </Tooltip>
                ))}
            </div>
        </section>
    );
}

function StatusModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const { store } = settings;
    const [mode, setMode] = useState<Mode>(store.mode === "train" ? "train" : "departures");
    const [station, setStation] = useState(store.station ?? "");
    const [via, setVia] = useState(store.via ?? "");
    const [format, setFormat] = useState(store.format || DEFAULT_STATUS_FORMAT);
    const [categories, setCategories] = useState((store.categories ?? "").split(",").map(c => c.trim()).filter(Boolean));
    const [available, setAvailable] = useState(categories);
    const [train, setTrain] = useState(store.train ?? "");
    const [trainDate, setTrainDate] = useState(store.trainDate || "");
    const [trainFormat, setTrainFormat] = useState(store.trainFormat || DEFAULT_TRAIN_FORMAT);
    const [busy, setBusy] = useState(false);

    const todayStr = toLocalDateString();
    const yesterdayStr = getYesterdayString();
    const isToday = !trainDate || trainDate === TODAY || trainDate === todayStr;
    const isYesterday = trainDate === YESTERDAY || trainDate === yesterdayStr;
    const calendarValue = trainDate === YESTERDAY
        ? yesterdayStr
        : (!trainDate || trainDate === TODAY ? todayStr : trainDate);

    function toggleCategory(category: string, on: boolean) {
        setCategories(on ? [...categories, category] : categories.filter(c => c !== category));
    }

    async function loadCategories() {
        setBusy(true);
        try {
            const place = await findStation(station.trim());
            if (!place) {
                showToast({ text: `No station found for "${station.trim()}".`, variant: "critical" });
                return;
            }
            setStation(place.name);
            const found = await boardCategories(place.evaNumber, settings.store.lookahead);
            setAvailable([...new Set([...found, ...categories])].sort((a, b) => a.localeCompare(b)));
            if (!found.length) showToast({ text: `Nothing is departing from ${place.name} right now.` });
        } catch {
            showToast({ text: "bahn.expert did not answer. Try again in a moment.", variant: "critical" });
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        setBusy(true);
        try {
            if (mode === "train") {
                const date = resolveTrainDate(trainDate);
                const journey = await findTrain(train, date);
                if (!journey) {
                    showToast({ text: `No train found for "${train.trim()}" ${formatTrainDateLabel(trainDate)}.`, variant: "critical" });
                    return;
                }
                store.train = train.trim();
                store.trainDate = toLocalDateString(date);
                store.trainFormat = trainFormat.trim() || DEFAULT_TRAIN_FORMAT;
                showToast({ text: `Following ${journey.train.name} to ${journey.finalDestination}.`, variant: "success" });
            } else {
                const place = await findStation(station.trim());
                if (!place) {
                    showToast({ text: `No station found for "${station.trim()}".`, variant: "critical" });
                    return;
                }
                store.station = place.name;
                store.via = via.trim();
                store.categories = categories.join(",");
                store.format = format.trim() || DEFAULT_STATUS_FORMAT;
                showToast({ text: `Showing departures from ${place.name}.`, variant: "success" });
            }
            store.mode = mode;
            refresh();
            modalProps.onClose();
        } catch {
            showToast({ text: "bahn.expert did not answer. Try again in a moment.", variant: "critical" });
        } finally {
            setBusy(false);
        }
    }

    const ready = mode === "train" ? train.trim() : station.trim();

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Bahn status"
            subtitle="Shown as the status of whichever voice channel you are in."
            actions={[{ text: "Save", variant: "primary", disabled: busy || !ready, onClick: save }]}
        >
            <form className={cl("content")} onSubmit={e => { e.preventDefault(); if (!busy && ready) save(); }}>
                <section className={Margins.bottom16}>
                    <Heading tag="h5">Mode</Heading>
                    <Select options={MODE_OPTIONS} isSelected={v => v === mode} select={setMode} serialize={v => v} />
                </section>
                {mode === "train"
                    ? <>
                        <section className={Margins.bottom16}>
                            <Heading tag="h5">Train</Heading>
                            <TextInput value={train} onChange={setTrain} placeholder="ICE 702, RE 4711 or just 702" autoFocus />
                            <Paragraph className={Margins.top8}>Give the category too when the number alone is ambiguous.</Paragraph>
                        </section>
                        <section className={Margins.bottom16}>
                            <Heading tag="h5">Departure Date</Heading>
                            <div className={cl("date-row")}>
                                <div className={cl("date-buttons")}>
                                    <Button
                                        type="button"
                                        size="small"
                                        variant={isToday ? "primary" : "secondary"}
                                        onClick={() => setTrainDate(TODAY)}
                                    >
                                        Today
                                    </Button>
                                    <Button
                                        type="button"
                                        size="small"
                                        variant={isYesterday ? "primary" : "secondary"}
                                        onClick={() => setTrainDate(YESTERDAY)}
                                    >
                                        Yesterday
                                    </Button>
                                </div>
                                <input
                                    type="date"
                                    className={cl("date-input")}
                                    value={calendarValue}
                                    onClick={e => e.currentTarget.showPicker()}
                                    onChange={e => setTrainDate(e.target.value)}
                                />
                            </div>
                            <Paragraph className={Margins.top8}>Select the departure day of the train. Useful for night trains or runs from the previous day.</Paragraph>
                        </section>
                        <FormatField value={trainFormat} placeholders={TRAIN_PLACEHOLDERS} onChange={setTrainFormat} />
                    </>
                    : <>
                        <section className={Margins.bottom16}>
                            <Heading tag="h5">Station</Heading>
                            <TextInput value={station} onChange={setStation} placeholder="Hamburg Hbf, 8002549 or AH" autoFocus />
                        </section>
                        <section className={Margins.bottom16}>
                            <Heading tag="h5">Via</Heading>
                            <TextInput value={via} onChange={setVia} placeholder="Only departures passing this stop, optional" />
                        </section>
                        <section className={Margins.bottom16}>
                            <Heading tag="h5">Verkehrsmittel</Heading>
                            <Paragraph>Tick none to show every category.</Paragraph>
                            {available.length
                                ? <div className={cl("categories")}>
                                    {available.map(category => (
                                        <Checkbox
                                            key={category}
                                            value={categories.includes(category)}
                                            onChange={(_, on) => toggleCategory(category, on)}
                                            shape="box"
                                            size={20}
                                        >
                                            <BaseText size="sm">{category}</BaseText>
                                        </Checkbox>
                                    ))}
                                </div>
                                : null}
                            <Button className={Margins.top8} variant="secondary" size="small" disabled={busy || !station.trim()} onClick={loadCategories}>
                                {available.length ? "Reload categories" : "Load categories for this station"}
                            </Button>
                        </section>
                        <FormatField value={format} placeholders={PLACEHOLDERS} onChange={setFormat} />
                    </>}
            </form>
        </Modal>
    );
}

const SafeStatusModal = ErrorBoundary.wrap(StatusModal);

export function openStatusModal() {
    return openModal(modalProps => <SafeStatusModal modalProps={modalProps} />);
}
