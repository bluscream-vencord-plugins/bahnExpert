# BahnExpert

Train departures from [bahn.expert](https://bahn.expert), inside Discord.

## Slash commands

`/zug train:<ICE 702|702> [datum:<yesterday|YYYY-MM-DD>]` answers with where that train is right now.

`/abfahrten station:<name|EVA|RIL100> [via:<stop>] [verkehrsmittel:<ICE,RE,S>] [count:<n>]`

Replies with an ephemeral message listing the next departures, for example:

```
Hamburg Hbf via Berlin
`23:15` **ICE 702** → Berlin Hbf (+4)
```

## Live voice channel status

One configuration, active wherever you go. While the **Bahn Status** toggle is on, the plugin writes
its text into the status of whichever voice channel you are connected to, provided you may set
statuses there, and refreshes it on the interval from the plugin settings. The text is only
written when it actually changes. Open the configuration from the plugin settings or by right
clicking any voice channel and picking **Configure Bahn Status**; the same context menu has the
toggle. With the EquicordToolbox plugin enabled, both also appear in its menu.

Two modes:

- **Departures from a station**: station, optional via stop, Verkehrsmittel filter and format.
  The status shows the next matching departure.
- **Follow a train**: `ICE 702`, `RE 4711` or just a number, plus an optional departure date (quick
  **Today** / **Yesterday** buttons or an inline calendar picker). The status shows the stop the train
  is heading to or standing at, when it gets there, the platform and the final destination.
  Default: `[{rel}{delay}] {nextStop} Gl. {stopTrack} → {dest}`. The `/zug` command shows the
  same line once. bahn.expert does not know on which side the doors open, so there is no exit
  side placeholder.

Below each format field every placeholder is a button. Clicking one inserts it at the cursor, and
hovering shows what it produces.

### Existing statuses are kept

Before the first write into a channel, and whenever a status appears that the plugin did not
write itself, that text is remembered. When the plugin lets go of the channel, the text is put
back; if there was nothing to put back, the status is cleared. The plugin lets go when you leave
the channel, move to another one, switch the toggle off, or disable the plugin. Discord only
accepts status writes from ordinary members while they are connected, which is why the status
follows you instead of staying on a channel, and why the plugin hooks Discord's own leave and
switch routine: the restore is sent first, and the leave or switch goes out once it is done or
after at most one second, whichever comes first. If you click again meanwhile, only your latest
choice is carried out. Being kicked, moved or dropped by the server skips that path; the restore is then attempted
afterwards and succeeds only if you may set statuses in channels you are not in.

### Filtering by Verkehrsmittel

**Load categories for this station** resolves the station and ticks off the product categories
actually on its board right now, such as `ICE`, `RE`, `S` and `Bus`. Leave every box unticked to
show all of them.

The filter matches on the product category, because IRIS departure boards leave the
`transportType` field empty on every entry. Category is the only field that really describes the
Verkehrsmittel, and it is what Deutsche Bahn itself prints on the board.

### Format placeholders

| Placeholder        | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `{station}`        | The station the board belongs to                                |
| `{time}`           | Expected departure, `HH:mm`                                     |
| `{scheduled}`      | Scheduled departure, `HH:mm`                                    |
| `{rel}`            | Relative time, `in 5m` or `now`                                 |
| `{relShort}`       | Relative time without the words, `5m`                           |
| `{line}`           | Full product label, `ICE 106` or `S1`                           |
| `{cat}`            | Category on its own, `ICE`, `RE`, `S` or `Bus`                  |
| `{nr}`             | Journey number, `106`                                           |
| `{lineNr}`         | Line label, `S1` or `RE7`, empty when the product has no line   |
| `{dest}`           | Destination                                                     |
| `{next}`           | Next stop after this one                                        |
| `{platform}`       | Best known platform                                             |
| `{schedPlatform}`  | Scheduled platform                                              |
| `{delay}`          | Signed delay, `+5`, empty when on time                          |
| `{delayMin}`       | Delay in minutes as a bare number, empty when on time           |
| `{cancelled}`      | `fällt aus` when the stop is cancelled, else empty              |
| `{platformChange}` | `Gl. 7` when the platform moved, else empty                     |
| `{extra}`          | Delay, cancellation and platform change combined in brackets    |

Default: `{rel} {line} → {dest}{extra}`

Train mode placeholders:

| Placeholder        | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `{rel}`            | Time until the train reaches or leaves the next stop, `in 5m`, `now` |
| `{relShort}`       | The same without the words                                           |
| `{time}`           | Expected time at the next stop, `HH:mm`                              |
| `{scheduled}`      | Scheduled time at the next stop                                      |
| `{delay}`          | Signed delay, `+5`, empty when on time                               |
| `{delayMin}`       | Delay in minutes as a bare number                                    |
| `{line}`           | Train name, `ICE 702`                                                |
| `{cat}`            | Category on its own, `ICE`                                           |
| `{nr}`             | Journey number, `702`                                                |
| `{origin}`         | Where the train started                                              |
| `{nextStop}`       | The stop the train is heading to or standing at                      |
| `{stopTrack}`      | Platform at that stop                                                |
| `{schedTrack}`     | Scheduled platform at that stop                                      |
| `{after}`          | The stop after the next one                                          |
| `{dest}`           | Final destination                                                    |
| `{cancelled}`, `{platformChange}`, `{extra}` | As in departures mode                      |

An unknown placeholder is left in the text as written, so a typo is visible rather than silent.

## How it talks to bahn.expert

bahn.expert only answers requests carrying a `Referer` on its own origin and a browser style
`User-Agent`, and it sends no CORS headers. The renderer can do neither, so `native.ts` performs
the request from the main process. Only the procedure name and the serialized body cross the IPC
boundary, and both are validated there. The API client is
[bahn-expert-ts](https://github.com/Bluscream/bahn-expert-ts), included as a git submodule in
`bahn-expert-ts/`.

When the update interval's requests fail, the wait before the next one doubles each time, and goes
back to the configured interval after the next success.

The plugin is desktop only, since the requests need the main process.

## Install

```sh
cd src/userplugins
git clone --recurse-submodules https://github.com/bluscream-vencord-plugins/bahnExpert bahnExpert.desktop
cd bahnExpert.desktop/bahn-expert-ts
git sparse-checkout set --no-cone /src/ /LICENSE /README.md
```

`bahn-expert-ts` is a private repository, so the submodule only downloads with access to it. The
sparse checkout keeps only the client's source: its tests and tooling configs would otherwise
break Equicord's type check. Update with `git pull --recurse-submodules`, then rebuild Equicord.
