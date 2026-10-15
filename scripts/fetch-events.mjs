/**
 * Build the Pioneer Square events feed.
 *
 * Aggregates upcoming events in Pioneer Square, Seattle into site/events.json and
 * site/events.ics. A sister of lqa-events' build (the shared modules are theirs,
 * byte for byte); only the sources below and site/city.js are Pioneer Square's.
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
import { writeFileSync, readFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { dropTimeClashes, isChurch, parseShowboxEvents } from './sources.mjs';
import { feedSources, emptyListGate } from './feeds.mjs';
import { mergeWithArchive, unionArchives, eventKey } from './merge.mjs';
import { calmTitle, isNotice } from './titles.mjs';
import { applySchedules } from './schedules.mjs';
import { slugify, BADGE_FEEDS, TEAMS, CITY } from './badges.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: venues announce whole seasons ahead, and past events
// are kept for a year (carried forward from the previously published feed —
// see mergeWithArchive).
const WINDOW_DAYS = 365;
// The live feed is read from the site's own domain (a build that reads
// neither copy of the archive refuses to publish — see mergeWithArchive;
// ALLOW_NO_ARCHIVE=1 lets the very first build through).
const FEED_URL = process.env.FEED_URL || 'https://pioneersquare.seattle.here.events/events.json';
// the second copy of the archive: every past event ever published, kept on
// the orphan `archive` branch by the workflow after each successful build
const ARCHIVE_URL = process.env.ARCHIVE_URL || 'https://raw.githubusercontent.com/sfosdal/pioneersquare-events/archive/events-archive.json';
const ARCHIVE_OUT = new URL('../events-archive.json', import.meta.url); // repo root, ignored; the workflow commits it to the branch
const MAX_EVENTS = 4000; // sanity cap, not a display cap

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Local runs: when the environment doesn't provide TICKETMASTER_API_KEY (CI
// passes it as a repo secret), pick it up from an untracked repo-root .env so
// the localhost preview gets the arena listings too.
if (!process.env.TICKETMASTER_API_KEY) {
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^TICKETMASTER_API_KEY=(.+)$/m);
    if (m) process.env.TICKETMASTER_API_KEY = m[1].trim();
  } catch { /* no .env — Ticketmaster sources warn and skip */ }
}

// --- Ticketmaster Discovery API ---
// Ticketmaster's resale marketplace (source "tmr": an id starting "Z7r9j", a
// ticketmaster.com/event/ link) lists shows whose box office is elsewhere, a
// second listing beside the primary, titled differently so the duplicate
// guard can't fold them. A resale listing is kept only when no primary one
// shares its date, and it links to the box office the listing names or the
// venue's own page, never to the resale offer.
const isResale = (e) => /^Z7r9j/.test(e.id || '');
function tmEvent(e, venue, fallbackUrl) {
  const boxOffice = (e.outlets || []).find((o) => o.type === 'venueBoxOffice')?.url;
  const ev = {
    venue,
    title: e.name,
    date: e.dates?.start?.localDate || '',
    time: e.dates?.start?.localTime || '',
    url: isResale(e) ? (boxOffice || fallbackUrl) : (e.url || fallbackUrl),
  };
  if (e.ageRestrictions?.legalAgeEnforced) ev.age21 = true;
  const seg = e.classifications?.[0]?.segment?.name || '';
  const type = /sports/i.test(seg) ? 'sports' : /music/i.test(seg) ? 'concert' : /arts|theat/i.test(seg) ? 'arts' : /film/i.test(seg) ? 'movie' : null;
  if (type) ev.type = type;
  if (e.dates?.start?.dateTBD || e.dates?.start?.dateTBA) ev.dateTbd = true; // a placeholder date the promoter may still move
  // a cancelled or postponed show stays in Ticketmaster's listing for a
  // while, marked in dates.status — pass that on rather than list it as if
  // it were still happening (the merge step drops it once it vanishes)
  const code = e.dates?.status?.code;
  if (code === 'cancelled' || code === 'postponed') ev.status = code;
  return ev;
}
function keepPrimary(rows) {
  const primaryDates = new Set(rows.filter((e) => !isResale(e)).map((e) => e.dates?.start?.localDate));
  return rows.filter((e) => !isResale(e) || !primaryDates.has(e.dates?.start?.localDate));
}
async function tmPages(params, label) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const all = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ apikey: key, sort: 'date,asc', size: '200', page: String(page), ...params });
    await new Promise((r) => setTimeout(r, 1500)); // 1.5 s between requests: the key is shared across twelve sister sites' builds
    let res;
    for (let attempt = 0; ; attempt++) { // a 429 (the shared key's quota) waits eight seconds and tries again, six times
      res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
      if (res.status !== 429 || attempt >= 6) break;
      console.warn(`Ticketmaster ${label} page ${page} HTTP 429 — waiting 8 s (retry ${attempt + 1} of 6)`);
      await new Promise((r) => setTimeout(r, 8000));
    }
    if (!res.ok) { console.error(`Ticketmaster ${label} page ${page} HTTP ${res.status}`); break; }
    const data = await res.json();
    all.push(...(data?._embedded?.events || []));
    if (page + 1 >= (data?.page?.totalPages || 1)) break;
  }
  console.log(`Ticketmaster ${label}: ${all.length} events`);
  return all;
}
// by venue id (every page), for the rooms city.js names
async function ticketmasterVenue({ venueId, venueMatch, label, fallbackUrl, exclude }) {
  const rows = (await tmPages({ venueId }, label))
    .filter((e) => (e._embedded?.venues?.[0]?.name || '').toLowerCase().includes(venueMatch))
    .filter((e) => !exclude || !exclude.test(e.name || ''));
  return keepPrimary(rows).map((e) => tmEvent(e, label, fallbackUrl));
}
const ticketmasterRooms = Object.entries(CITY.venues).filter(([, v]) => v.tm)
  .map(([label, v]) => () => ticketmasterVenue({ venueId: v.tm.id, venueMatch: v.tm.match, label, fallbackUrl: v.tm.fallbackUrl, exclude: v.tm.exclude }));
async function pageText(url) {
  const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}
// Showbox SoDo: AEG's whole Northwest listing on one server-rendered page,
// the SoDo room kept — parseShowboxEvents (lqa's; Ticketmaster has only resale)
async function showbox() {
  const evs = parseShowboxEvents(await pageText('https://www.showboxpresents.com/events/all'));
  console.log(`Showbox SoDo: ${evs.length} shows`);
  return evs;
}
// Rooms with their own calendar (city.js `feed`) and the neighbourhood calendar (city.js `feeds`) come through feeds.mjs
const sources = [...ticketmasterRooms, showbox, ...feedSources(CITY, BROWSER_UA)];
// Secondary sources re-list shows the primaries carry under other titles;
// anything at an already-taken venue/date/time is dropped. None yet.
const secondary = [];

// Venue names as city.js spells them: a venue listed under other spellings
// (`alias` — "Miller Park", "Eagles Ballroom", "BMO Harris Pavilion")
// folds to its one name; `groundsVenue`, when a city sets one, takes the
// rooms city.js doesn't list.
const CANONICAL_VENUES = new Set(Object.keys(CITY.venues));
const ALIASES = Object.entries(CITY.venues).filter(([, v]) => v.alias).map(([label, v]) => [label, v.alias]);
const aliasHit = (s) => { const hit = ALIASES.find(([, re]) => re.test(s || '')); return hit ? hit[0] : null; };
const aliasVenue = (name) => aliasHit(name) || name;
// A listing whose venue field is just the city names its room at the end of
// the title ("X live at The Vic").
const roomInTitle = (title) => { const m = /\b(?:at|@)\s+(.+)$/i.exec(title || ''); return m ? aliasHit(m[1]) : null; };
const normalizeVenue = (e) => {
  const byName = aliasVenue(e.venue);
  const venue = CANONICAL_VENUES.has(byName) ? byName : (roomInTitle(e.title) || byName);
  if (CITY.groundsVenue && !CANONICAL_VENUES.has(venue)) return { ...e, venue: CITY.groundsVenue };
  return venue === e.venue ? e : { ...e, venue };
};

// Church events never make the listing (Steve, 2026-10-11, for Everett;
// the same here), judged on the
// source's own venue name and title before anything folds into the
// Elsewhere row; the count is logged so a new church booking is visible.
let churchDropped = 0;
const noChurch = (rows) => rows.filter((e) => { if (isChurch(e)) { churchDropped++; return false; } return true; });

let all = [];
for (const src of sources) {
  try { all = all.concat(noChurch(await src()).map(normalizeVenue)); }
  catch (err) { console.error('Source failed:', err.message); }
}
for (const src of secondary) {
  try { all = all.concat(dropTimeClashes(noChurch(await src()).map(normalizeVenue), all)); }
  catch (err) { console.error('Source failed:', err.message); }
}
if (churchDropped) console.log(`Church events dropped: ${churchDropped}`);

// window, de-dupe, sort
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const fresh = all
  .filter((e) => e.date && e.date >= cutoff && e.date <= horizon)
  .filter((e) => !isNotice(e.title)) // a closure or construction notice is information, not an event
  .map((e) => ({ ...e, title: calmTitle(e.title) })) // shouted titles come down to Title Case
  .filter((e) => { const k = eventKey(e); if (seen.has(k)) return false; seen.add(k); return true; }); // venue|title|date|clock (merge.mjs): a second showing on one day is kept
// the empty-list gate (feeds.mjs): nothing upcoming in this build's own pull means a room was
// missed or every source is down — say so and stop rather than publish an empty calendar
if (!emptyListGate(fresh, today, sources.length)) process.exit(1);

// carry past events forward. Two copies of the archive: the live feed and
// the `archive` branch's file (every past event ever published; the workflow
// rewrites it after each build). Each is fetched with three tries; the build
// goes on with the union of whatever it got and stops only when it got
// neither. Since the union can only grow, a publish that lost history can no
// longer shrink the record.
const cleanArchive = (d) => (Array.isArray(d) ? d : (d.events || []))
  .filter((e) => !isChurch(e)) // past church events leave the record too
  .map(normalizeVenue) // past events published under other spellings fold onto the one name
  .filter((e) => !isNotice(e.title)).map((e) => ({ ...e, title: calmTitle(e.title) })); // the same title hygiene as fresh events, so the merge keys agree
async function fetchArchive(url, what) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return cleanArchive(await r.json());
    } catch (err) {
      console.error(`${what} fetch (try ${attempt} of 3) failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 20000));
    }
  }
  return null;
}
const [liveArchive, branchArchive] = await Promise.all([
  fetchArchive(FEED_URL, 'Live feed'),
  fetchArchive(ARCHIVE_URL, 'Archive branch'),
]);
if (liveArchive === null && branchArchive === null && !process.env.ALLOW_NO_ARCHIVE) {
  console.error('No archive from either copy — not publishing (ALLOW_NO_ARCHIVE=1 to override for a first build)');
  process.exit(1);
}
if (liveArchive === null) console.error('Live feed unreadable — building on the archive branch copy');
if (branchArchive === null) console.error('Archive branch unreadable — building on the live feed alone');
const archived = unionArchives(liveArchive || [], branchArchive || []);
console.log(`Archive: ${(liveArchive || []).length} events in the live feed, ${(branchArchive || []).length} on the archive branch, ${archived.length} in the union`);

const merged = mergeWithArchive(fresh, archived, today, cutoff).slice(-MAX_EVENTS);

// League schedules flag floating dates Ticketmaster doesn't know yet, and
// the full seasons (home and away) feed the site's Teams view
let seasons = {}, form = {};
try { ({ teams: seasons, form } = await applySchedules(merged)); } catch (err) { console.error('Schedules step failed:', err.message); }
// The clubs whose home games have no ticket feed here (city.js `inject`:
// none in Pioneer Square: the stadium clubs' games arrive through Ticketmaster, the Kraken and Storm are Teams-view-only) enter
// the listing from the league's schedule — typed sports, the club's ticket
// page as the link — unless the feed already has that day at that ground
for (const t of CITY.teams.filter((x) => x.inject)) { // CITY.teams, not badges.mjs's TEAMS, which keeps only slug/label/re
  for (const g0 of (seasons[t.slug] || []).filter((x) => x.home && x.date >= cutoff)) {
    // ESPN's placeholder for a game without a kickoff time is midnight Eastern
    // (04:00Z), which schedules.mjs renders in Pacific as 9 PM the day before;
    // a date-TBD game therefore belongs to the next calendar day here
    const g = g0.tbd && !g0.time ? { ...g0, date: new Date(Date.parse(g0.date + 'T12:00:00Z') + 86400e3).toISOString().slice(0, 10) } : g0;
    const venue = t.venue; // the club's own room as city.js spells it, so the game de-dupes against the room's Ticketmaster listing
    const listed = merged.find((e) => e.date === g.date && e.venue === venue);
    if (listed) { if (!listed.time && g.time && !g.tbd) listed.time = g.time; continue; } // the feed's listing stands; the league's first pitch fills a time it lacks
    merged.push({ venue, title: `${t.inject.name || t.name || t.label} vs ${g.opp.name}`, date: g.date, time: g.time, url: t.inject.url, type: 'sports', ...(g.tbd ? { dateTbd: true } : {}), ...(g.watch ? { watch: g.watch } : {}) });
  }
}
// March to the Match: the Sounders' supporters gather in Occidental Park and
// march to Lumen Field before every home game, 90 minutes before kickoff — a
// Pioneer Square event in its own right, written from the club's schedule
// (Steve, 2026-10-15). The title names the opponent, not the club, so the
// row stays a community row rather than a game.
for (const g of (seasons.sounders || []).filter((x) => x.home && x.date >= today && x.time && !x.tbd)) { // from today: no synthetic rows into the archive
  const [h, m] = g.time.split(':').map(Number); const mins = h * 60 + m - 90;
  if (mins < 0 || merged.some((e) => e.date === g.date && e.venue === 'Occidental Square' && /march to the match/i.test(e.title))) continue;
  merged.push({ venue: 'Occidental Square', title: `March to the Match (before the ${g.opp.short || g.opp.name} game)`, date: g.date, time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`, url: 'https://weareecs.com/march-to-the-match', type: 'community', free: true });
}
// Owl 'n Thistle prints a weekly schedule with no dates (owlnthistle.com/live-music-schedule),
// so the next ten weeks are written out from it — no clock, since the page prints none;
// Sunday alternates and is left out. Re-copy the table when the pub changes it.
const OWL = { 1: 'Aqualizer', 2: "Jazz Jam — Seattle's longest-running jazz night", 4: 'Danny Godinez', 5: 'Irish Cover Band', 6: 'Irish Cover Band' }; // by weekday (Mon=1)
for (let i = 0; i < 70; i++) {
  const d = new Date(Date.parse(today + 'T12:00:00Z') + i * 86400e3), dow = d.getUTCDay(), date = d.toISOString().slice(0, 10);
  if (!OWL[dow] || merged.some((e) => e.venue === "Owl 'n Thistle" && e.date === date)) continue;
  merged.push({ venue: "Owl 'n Thistle", title: OWL[dow], date, time: '', url: 'https://owlnthistle.com/live-music-schedule', type: 'concert' });
}
// Ticket availability for the Ticketmaster venues, from a local checker
// (scripts/data/soldout.json — empty until one runs for Pioneer Square): counts and
// lowest price, and soldOut when the box office has nothing left.
try {
  const so = JSON.parse(readFileSync(new URL('./data/soldout.json', import.meta.url), 'utf8'));
  let n = 0, s = 0;
  for (const e of merged) {
    const m = (e.url || '').match(/\/event\/([0-9A-F]{16})/i); // Ticketmaster's 16-hex id
    const r = m && (so.events || {})[m[1].toUpperCase()];
    if (!r || !/^(available|soldout)$/.test(r.status)) continue;
    const out = r.status === 'soldout';
    e.tickets = { box: out ? 0 : (r.primary == null ? null : r.primary), resale: r.resale || 0, checked: r.checked };
    const from = out ? r.fromResale : r.fromPrimary;
    if (from != null) e.tickets.from = from;
    if (out) { e.soldOut = true; s++; }
    n++;
  }
  if (n) console.log(`soldout: ${n} events with ticket counts (checked ${so.generated}), ${s} sold out`);
} catch (err) { console.error('soldout.json:', err.message); }
merged.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
if (Object.keys(seasons).length) {
  const postseason = JSON.parse(readFileSync(new URL('./data/postseason.json', import.meta.url), 'utf8')); // each league's playoff rounds (hand-kept), shown until the real games land
  delete postseason._;
  writeFileSync(new URL('../site/teams.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), teams: seasons, form, postseason }, null, 1) + '\n');
} else {
  console.error('teams.json: no season fetched this run, the last one stands');
}

writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
// the archive record: this build's past events on top of everything already
// recorded, never pruned (the feed keeps a year; the branch keeps it all)
const record = unionArchives(merged.filter((e) => e.date < today), archived.filter((e) => e.date < today));
writeFileSync(ARCHIVE_OUT, JSON.stringify({ events: record }, null, 1) + '\n'); // no timestamp: the branch commits only when the events change
console.log(`Archive record: ${record.length} past events`);
writeFileSync(ICS_OUT, buildIcs(merged));

// Filtered subscribe feeds, one per venue and one per badge, so the site's
// filter chips can offer a matching calendar subscription.
const siteDir = new URL('../site/', import.meta.url);
let nFeeds = 0;
for (const venue of new Set(merged.map((e) => e.venue))) {
  const evs = merged.filter((e) => e.venue === venue);
  writeFileSync(new URL(`events-venue-${slugify(venue)}.ics`, siteDir),
    buildIcs(evs, new Date(), { calname: `${CITY.ics.short} — ${venue}` }));
  nFeeds++;
}
for (const [slug, [label, pred]] of Object.entries(BADGE_FEEDS)) {
  writeFileSync(new URL(`events-${slug}.ics`, siteDir),
    buildIcs(merged.filter(pred), new Date(), { calname: `${CITY.ics.short} — ${label}` }));
  nFeeds++;
}
// Exclusion feeds, one per local team: everything except that team's games.
for (const t of TEAMS) {
  writeFileSync(new URL(`events-no-${t.slug}.ics`, siteDir),
    buildIcs(merged.filter((e) => !t.re.test(e.title || '')), new Date(), { calname: `${CITY.ics.short} — no ${t.label}` }));
  nFeeds++;
}
// Season feeds for the Teams view: each club's whole season, home and away
// (team-<slug>.ics), and every club's in one (teams.ics). Each game links to
// the club's page on the site.
const seasonEvents = (slug, label, games) => games.map((g) => ({
  title: `${label} ${g.home ? 'vs' : 'at'} ${g.opp.name}${g.pre ? ' (preseason)' : g.playoff ? ' (playoff)' : ''}`,
  venue: g.venue || (g.home ? '' : g.opp.name), date: g.date, time: g.tbd ? null : g.time, ...(g.tbd ? { dateTbd: true } : {}),
  url: `${CITY.site}?team=${slug}`,
}));
const allSeasons = [];
for (const t of TEAMS) {
  if (!seasons[t.slug]) continue;
  const evs = seasonEvents(t.slug, t.label, seasons[t.slug]);
  allSeasons.push(...evs);
  writeFileSync(new URL(`team-${t.slug}.ics`, siteDir), buildIcs(evs, new Date(), { calname: `${t.label} season` }));
  nFeeds++;
}
writeFileSync(new URL('teams.ics', siteDir), buildIcs(allSeasons, new Date(), { calname: CITY.ics.teams }));
nFeeds++;

const nPast = merged.filter((e) => e.date < today).length;
console.log(`Wrote ${merged.length} events (${nPast} past, ${merged.length - nPast} upcoming) + ${nFeeds} filtered feeds`);
