# Pioneer Square Events

Event feed and calendar for Pioneer Square, Seattle — Baba Yaga, the Central
Saloon, the Seattle Jazz Fellowship, Trinity Nightclub, Nordo, Occidental
Square and the Alliance for Pioneer Square's neighbourhood calendar, with
Lumen Field, T-Mobile Park, WAMU Theater and Showbox SoDo a few blocks south
— plus the Seattle clubs' seasons (Seahawks, Mariners, Kraken, Storm, Reign,
Sounders) in the Teams view.

Live at **https://pioneersquare.seattle.here.events/** (GitHub Pages via
Actions, rebuilt once a day at noon Pacific).

## Sister sites

A sister of [lqa-events](https://github.com/sfosdal/lqa-events). The file
that makes this Pioneer Square's is `site/city.js` (every team, venue, type,
feed, share-code registry and string); `scripts/fetch-events.mjs` and
`scripts/sources.mjs` carry the city's own sources (the Showbox Presents
listing). Everything else — `site/app.js`, `filter.js`, `styles.css` bar its
`--v-*` hues, `scripts/*.mjs` — is lqa-events' own, byte for byte, synced by
its `sync-shared.sh`. The icons are lqa's for now.

## Embed

```html
<div id="pioneersquare-events"></div>
<script src="https://pioneersquare.seattle.here.events/embed.js" data-max="8" defer></script>
```

## Build

```sh
cp ../.env .   # TICKETMASTER_API_KEY=…
node scripts/fetch-events.mjs      # site/events.json, events.ics, teams.json
node --test scripts/*.test.mjs
```

Sources: Ticketmaster by venue id (Baba Yaga, Lumen Field, T-Mobile Park,
WAMU), Showbox Presents (Showbox SoDo), the rooms' own calendars through
`scripts/feeds.mjs` (schema.org events, Squarespace collections, Eventbrite
links, The Events Calendar REST) and the Alliance for Pioneer Square's
server-rendered calendar (`cards`), folded into `Around Pioneer Square` unless
the room has a row of its own. ESPN, MLB and the NHL for the clubs' seasons.
