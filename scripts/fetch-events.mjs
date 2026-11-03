/**
 * Build the Pioneer Square events feed.
 *
 * Aggregates upcoming events in Pioneer Square, Seattle into site/events.json and
 * site/events.ics. A sister of lqa-events' build (the shared modules are theirs,
 * byte for byte; the build itself is scripts/build.mjs); only the readers below and site/city.js are Pioneer Square's.
 *
 * Sources (all read-only, no scraping of ticket inventories):
 *   - Ticketmaster Discovery, by venue id: Baba Yaga's TicketWeb shows, Lumen
 *     Field, T-Mobile Park, WAMU Theater (primary listings only — the resale
 *     guard drops the Z7r9j rows)
 *   - Showbox Presents (showboxpresents.com/events/all) for Showbox SoDo —
 *     lqa's parser, the SoDo room kept
 *   - the rooms' own calendars through scripts/feeds.mjs (city.js `feed`):
 *     Central Saloon and Baba Yaga's ma.to page (schema.org), the Seattle Jazz
 *     Fellowship and Nordo (Squarespace), Trinity (Eventbrite links),
 *     Occidental Square (the Downtown Seattle Association's Events Calendar)
 *   - the Alliance for Pioneer Square's neighbourhood calendar and its First
 *     Thursday Art Walk pages (city.js `feeds`, the `cards` kind), folded by
 *     alias or into Around Pioneer Square
 *   - the National Park Service's events API for Klondike Gold Rush NHP (`nps`)
 *   - Friends of Waterfront Park's events page (`cards` on the Waterfront Park row)
 *   - written rules: March to the Match at Occidental Square before every
 *     Sounders home game; Owl 'n Thistle's weekly music table
 *   - ESPN, MLB and the NHL for the six Seattle clubs' seasons (Teams view);
 *     Seahawks, Sounders, Reign and Mariners home games are in the listing
 *     through the stadiums' Ticketmaster pages
 */
import './failures.mjs'; // first: every outside call retried, the ones still failing written to failures.json (Steve, 2026-10-29)
import { parseShowboxEvents, BABA_OBSCURA_URL, parseBabaObscuraSchedule, babaObscuraRows, festivalOwnsNights, parseMarinersIndex, parseMarinersEvent } from './sources.mjs';
import { feedFailedVenues, chromeFetch } from './feeds.mjs';
import { CITY } from './badges.mjs';
import { build, BROWSER_UA } from './build.mjs';

async function pageText(url) {
  const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
// T-Mobile Park's own events page (mlb.com/mariners/tickets/events): the events the club sells itself,
// which Ticketmaster never lists (Banana Ball, lottery-ticketed) — lqa-events' reader, copied 2026-10-31
// (parseMarinersIndex / parseMarinersEvent). Home games come from the Mariners' schedule as before.
const MARINERS_EVENTS = 'https://www.mlb.com/mariners/tickets/events';
async function marinersEvents() {
  const index = parseMarinersIndex(await pageText(MARINERS_EVENTS));
  const out = [];
  for (const it of index) {
    try { out.push(...parseMarinersEvent(await pageText(it.url), it)); }
    catch (err) { console.error(`T-Mobile Park ${it.url}: ${err.message}`); }
  }
  console.log(`T-Mobile Park (Mariners events page): ${out.length} rows from ${index.length} events`);
  return out;
}
// Showbox SoDo: AEG's whole Northwest listing on one server-rendered page,
// the SoDo room kept — parseShowboxEvents (lqa's; Ticketmaster has only resale)
// The page comes through the Chrome fingerprint (feeds.mjs chromeFetch): AEG's carbonhouse edge answers
// GitHub's runners 406 (2026-10-30); a failed read keeps the room's upcoming rows from the last feed.
const SHOWBOX_URL = 'https://www.showboxpresents.com/events/all';
async function showbox() {
  const html = (await chromeFetch([SHOWBOX_URL], 'Showbox SoDo')).get(SHOWBOX_URL);
  if (html == null) { feedFailedVenues.add('Showbox SoDo'); throw new Error(`Showbox Presents unreadable ${SHOWBOX_URL}`); }
  const evs = parseShowboxEvents(html);
  console.log(`Showbox SoDo: ${evs.length} shows`);
  return evs;
}
// Baba Obscura (Baba Yaga & Desert Daze, Nov 2026; Steve, 2026-10-29): the festival's schedule page, a
// schema.org MusicEvent per set — parseBabaObscuraSchedule (as on the Seattle site). The festival is its own
// venue (a row a night with the whole grid, the Showbox at the Market's stage included) and every set at a
// room this site lists sits at that room too; the billed headliners are the artists the home page features.
const BABA_STAGE_VENUE = (s) => (/^Baba Yaga/.test(s) ? 'Baba Yaga' : /^Axis/.test(s) ? 'Axis Pioneer Square' : CITY.venues[s] ? s : null);
async function babaObscura() {
  const home = await pageText('https://babaobscura.com/').catch((err) => { console.error('Baba Obscura home:', err.message); return ''; });
  const headliners = [...new Set([...home.matchAll(/href="\/artists\/([a-z0-9-]+)"/g)].map((m) => m[1].replace(/-/g, ' ')))];
  const evs = babaObscuraRows(parseBabaObscuraSchedule(await pageText(BABA_OBSCURA_URL)), { headliners, stageVenue: BABA_STAGE_VENUE });
  console.log(`Baba Obscura: ${evs.filter((e) => !e.set).length} nights, ${evs.filter((e) => e.set).length} sets at its rooms`);
  return evs;
}

// March to the Match: the Sounders' supporters gather in Occidental Park and
// march to Lumen Field before every home game, 90 minutes before kickoff — a
// Pioneer Square event in its own right, written from the club's schedule
// (Steve, 2026-10-15). The title names the opponent, not the club, so the
// row stays a community row rather than a game.
function marchToTheMatch(merged, seasons, today) {
  for (const g of (seasons.sounders || []).filter((x) => x.home && x.date >= today && x.time && !x.tbd)) { // from today: no synthetic rows into the archive
    const [h, m] = g.time.split(':').map(Number); const mins = h * 60 + m - 90;
    if (mins < 0 || merged.some((e) => e.date === g.date && e.venue === 'Occidental Square' && /march to the match/i.test(e.title))) continue;
    merged.push({ venue: 'Occidental Square', title: `March to the Match (before the ${g.opp.short || g.opp.name} game)`, date: g.date, time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`, url: 'https://weareecs.com/events/', type: 'community', free: true });
  }
}
// Owl 'n Thistle prints a weekly schedule with no dates (owlnthistle.com/live-music-schedule),
// so the next ten weeks are written out from it — no clock, since the page prints none;
// Sunday alternates and is left out. Re-copy the table when the pub changes it.
const OWL = { 1: 'Aqualizer', 2: "Jazz Jam — Seattle's longest-running jazz night", 4: 'Danny Godinez', 5: 'Irish Cover Band', 6: 'Irish Cover Band' }; // by weekday (Mon=1)
function owlNights(merged, today) {
  for (let i = 0; i < 70; i++) {
    const d = new Date(Date.parse(today + 'T12:00:00Z') + i * 86400e3), dow = d.getUTCDay(), date = d.toISOString().slice(0, 10);
    if (!OWL[dow] || merged.some((e) => e.venue === "Owl 'n Thistle" && e.date === date)) continue;
    merged.push({ venue: "Owl 'n Thistle", title: OWL[dow], date, time: '', url: 'https://owlnthistle.com/live-music-schedule', type: 'concert' });
  }
}

await build({
  feedUrl: 'https://pioneersquare.seattle.here.events/events.json',
  archiveUrl: 'https://raw.githubusercontent.com/sfosdal/pioneersquare-events/archive/events-archive.json',
  primary: (s) => [...s.tmFirst, showbox, marinersEvents, ...s.feedsFirst, babaObscura],
  // the festival owns its nights at the venues it plays: their placeholder rows give way, a set the venue lists itself stays the venue's
  afterSources: (all) => festivalOwnsNights(all),
  afterInject: (merged, { seasons, today }) => { marchToTheMatch(merged, seasons, today); owlNights(merged, today); },
});
