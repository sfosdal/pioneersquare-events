/**
 * Parsers for the Port of Everett's Revize CMS calendar. The calendar app
 * loads plain XML files from /calendar_app/db/ — an active-month index plus
 * one events file per month. Repeating events carry an explicit <dates>
 * list of occurrences (MM-DD-YYYY), which we expand to one event each.
 */

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// 'Aug 4, 2026' (or 'August 4, 2026') → '2026-08-04'; '' if unparseable
export function poeDate(s) {
  const m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(s).trim());
  if (!m) return '';
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  return mo ? `${m[3]}-${mo}-${m[2].padStart(2, '0')}` : '';
}

// active-month index → ['202608', '202609', ...]
export function parsePoeMonths(xml) {
  return [...String(xml).matchAll(/<month>(\d{6})<\/month>/g)].map((m) => m[1]);
}

// one month's events file → [{title, date, time}], one entry per occurrence.
// Cancellations and the Port's "special event parking rates" notices (which
// shadow the real events) are dropped.
export function parsePoeEvents(xml) {
  const out = [];
  for (const ev of String(xml).match(/<event [\s\S]*?<\/event>/g) || []) {
    const grab = (re) => { const m = ev.match(re); return m ? m[1].trim() : ''; };
    const title = grab(/<name>\s*<!\[CDATA\[([\s\S]*?)\]\]/);
    if (!title || /^CANCEL/i.test(title) || /^Special Event Parking/i.test(title)) continue;
    const rawTime = grab(/<time_begin>([^<]*)<\/time_begin>/);
    const time = /^\d{1,2}:\d{2}$/.test(rawTime) ? `${rawTime.padStart(5, '0')}:00` : '';
    const dates = [];
    const rawDates = grab(/<dates>\s*([^<]*?)\s*<\/dates>/);
    if (rawDates) {
      for (const d of rawDates.split(',')) {
        const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.trim());
        if (m) dates.push(`${m[3]}-${m[1]}-${m[2]}`);
      }
    } else {
      const iso = poeDate(grab(/<date_begin>([^<]*)<\/date_begin>/));
      if (iso) dates.push(iso);
    }
    for (const date of dates) out.push({ title, date, time });
  }
  return out;
}

/**
 * Squarespace calendar/event collections (Everett Music Initiative, Late
 * Shift Everett) answer `<page>?format=json` with the same data the page
 * renders: `upcoming` items carrying an epoch-ms startDate, an HTML-escaped
 * title, a site-relative fullUrl and a location.addressTitle venue.
 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    if (name in ENTITIES) return ENTITIES[name];
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name[0] === '#') return String.fromCodePoint(parseInt(name.slice(1), 10));
    return m;
  });
}

export function parseSquarespaceEvents(data, { base, fallbackVenue = 'Everett', venue } = {}) {
  const tz = data?.website?.timeZone || 'America/Los_Angeles';
  const fmtDate = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, dateStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, timeStyle: 'medium' });
  const out = [];
  for (const it of data?.upcoming || []) {
    if (!Number.isFinite(it.startDate)) continue;
    const start = new Date(it.startDate);
    out.push({
      venue: venue || (it.location?.addressTitle || '').trim() || fallbackVenue, // `venue` pins a room's own calendar to its row, whatever each entry's location field says
      title: decodeEntities(it.title || '').replace(/\s+/g, ' ').trim(),
      date: fmtDate.format(start),
      time: fmtTime.format(start),
      url: it.fullUrl ? new URL(it.fullUrl, base).href : base,
    });
  }
  return out;
}

// Church events are never listed (Steve, 2026-10-11: "keep church event 100%
// not listed"): a listing whose venue or title names a church, chapel,
// ministry, worship service, congregation, parish or cathedral is dropped at
// every source and from the archive, before venue folding (so it cannot hide
// in "Elsewhere in Everett"). Tested in sources.test.mjs.
// The pattern also catches a music room that merely bears a church's name (a
// "Tabernacle"); none of Pioneer Square's rooms does, so CHURCH_EXEMPT is empty —
// add the room's name here before adding such a room to city.js.
const CHURCH_RE = /\b(?:church(?:es)?|chapel|ministr(?:y|ies)|worship|congregation|parish|cathedral|tabernacle|sermon|bible stud(?:y|ies)|new life center)\b/i;
const CHURCH_EXEMPT = [];
export function isChurch(e) { if (CHURCH_EXEMPT.includes(e.venue)) return false; return CHURCH_RE.test(e.venue || '') || CHURCH_RE.test(e.title || ''); }

// Secondary sources list shows the primary ones already carry under slightly
// different titles ("… & Lady A" vs "… + Lady A"), so exact-key de-dupe
// misses them. A candidate is dropped when an existing event sits at the
// same venue, date and clock time; untimed events never clash.
export function dropTimeClashes(candidates, existing) {
  const taken = new Set(existing.filter((e) => e.time).map((e) => `${e.venue}|${e.date}|${e.time}`));
  return candidates.filter((e) => !e.time || !taken.has(`${e.venue}|${e.date}|${e.time}`));
}

/**
 * NWAC (Northwest Athletic Conference) schedules — the Everett Community
 * College Trojans' home games. nwacsports.com runs on PrestoSports, whose
 * schedule pages answer `?print=ical` with the whole conference's season for
 * one sport (the teamId parameter is ignored), so the feed is filtered to
 * the one college here. A VEVENT carries DTSTART (UTC, or ;VALUE=DATE for a
 * day with no time yet), SUMMARY "(Women's Soccer) Northwest University at
 * Everett (6-0)" — the sport in parentheses, "A at B" with B the host or
 * "A vs. B" at a neutral site, a score once final — CATEGORIES the sport,
 * LOCATION the ground ("Everett Memorial Stadium\, 3900 Broadway\, Everett\,
 * WA"), URL the box score's site path. A game is a home game when the
 * LOCATION names Everett (an "Everett vs." friendly at Starfire is not).
 */
const PT_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', dateStyle: 'short' });
const PT_TIME = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', timeStyle: 'medium' });
function icsText(s) { return String(s || '').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim(); }
export function parseNwacIcal(ics, { team = 'Everett', name = 'Everett CC Trojans', venue = 'Everett Community College', sport = '', base = 'https://nwacsports.com' } = {}) {
  const text = String(ics).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); // unfold continuation lines
  const out = [];
  for (const ev of text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []) {
    const grab = (key) => { const m = ev.match(new RegExp(`^${key}(;[^:\\n]*)?:(.*)$`, 'm')); return m ? [m[2].trim(), m[1] || ''] : ['', '']; };
    const [summaryRaw] = grab('SUMMARY'), [location] = grab('LOCATION'), [categories] = grab('CATEGORIES'), [url] = grab('URL'), [dtstart, params] = grab('DTSTART');
    const summary = icsText(summaryRaw);
    const m = summary.match(/^(?:\(([^)]*)\)\s*)?(.*?)(?:\s*\(\d+-\d+\))?$/); // "(sport) A at B (score)"
    const kind = (m && m[1]) || icsText(categories) || sport;
    const matchup = (m && m[2]) || summary;
    const sides = matchup.split(/\s+(?:at|vs\.?)\s+/i);
    if (sides.length !== 2) continue;
    const away = /\s+at\s+/i.test(matchup) ? sides[0] : null;
    const hasTeam = new RegExp(`\\b${team}\\b`, 'i');
    if (!hasTeam.test(sides[0]) && !hasTeam.test(sides[1])) continue;
    const home = /everett/i.test(icsText(location)) || (!icsText(location) && away !== null && hasTeam.test(sides[1]));
    if (!home) continue;
    const opp = hasTeam.test(sides[0]) ? sides[1] : sides[0];
    let date = '', time = '';
    if (/VALUE=DATE/i.test(params)) { const d = dtstart.match(/^(\d{4})(\d{2})(\d{2})/); if (d) date = `${d[1]}-${d[2]}-${d[3]}`; }
    else { const d = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); if (d) { const t = new Date(Date.UTC(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6])); date = PT_DATE.format(t); time = PT_TIME.format(t); } }
    if (!date) continue;
    out.push({ venue, title: `${name} vs ${opp}${kind ? ` (${kind})` : ''}`, date, time, url: url ? new URL(icsText(url), base).href : base, type: 'sports' });
  }
  return out;
}

// --- CivicPlus calendars: the cities (Everett, Marysville, Mukilteo,
//     Snohomish) and the Everett Public Library run CivicPlus, whose
//     RSSFeed.aspx?ModID=58&CID=All-calendar.xml lists the month's events
//     with <calendarEvent:EventDates> "October 13, 2026",
//     <calendarEvent:EventTimes> "10:30 AM - 11:00 AM" and
//     <calendarEvent:Location> an address. Council, board and commission
//     meetings are civic business, not events, and go; Snohomish prefixes
//     permitted events with the permit's status ("APPROVED 2026 River Run"). ---
const MONTH_NO = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
export function civicDate(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(String(s || ''));
  const mo = m && MONTH_NO[m[1].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}
export function civicTime(s) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?/.exec(String(s || ''));
  if (!m) return '';
  let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}:00`;
}
const MEETING_RE = /\b(?:council|commission|committee|board|hearing|work session|study session|meeting|food bank|support group|klatch|office hours|public comment)\b/i;
export function isMeeting(title) { return MEETING_RE.test(title || ''); }
export function parseCivicPlusRss(xml, { venue, strip = /^(?:APPROVED|TENTATIVE|PENDING)\s*[-:]?\s*/i } = {}) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const tag = (n) => { const r = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(item); return r ? decodeEntities(r[1].replace(/<!\[CDATA\[|\]\]>/g, '')).replace(/\s+/g, ' ').trim() : ''; };
    const title = tag('title').replace(strip, '');
    const date = civicDate(tag('calendarEvent:EventDates'));
    if (!title || !date || isMeeting(title)) continue;
    out.push({ venue, title, date, time: civicTime(tag('calendarEvent:EventTimes')), url: tag('link') });
  }
  return out;
}

// --- Sno-Isle Libraries: the BiblioCommons events gateway
//     (gateway.bibliocommons.com/v2/libraries/sno-isle/events, 100 a page)
//     answers with entities.events, each wrapping a `definition` of title,
//     start/end ("2026-12-16T09:30", local), branchLocationId and
//     isCancelled. The branches a short drive from Everett are kept and
//     named in the title; the rest of the system (Oak Harbor, Sultan, the
//     bookmobile) is not. ---
export function parseBiblioCommonsEvents(data, { venue, branches, base = 'https://sno-isle.bibliocommons.com' }) {
  const out = [];
  for (const [id, ev] of Object.entries(data?.entities?.events || {})) {
    const d = ev?.definition || {};
    const branch = branches[String(d.branchLocationId)];
    if (!branch || d.isCancelled || !/^\d{4}-\d{2}-\d{2}/.test(d.start || '')) continue;
    const title = decodeEntities(d.title || '').replace(/\s+/g, ' ').trim();
    if (isMeeting(title)) continue; // Friends of the Library meetings, the library board
    out.push({ venue, title: `${title} (${branch})`, date: d.start.slice(0, 10), time: /T\d{2}:\d{2}/.test(d.start) ? `${d.start.slice(11, 16)}:00` : '', url: `${base}/events/${id}` });
  }
  return out;
}

// --- JSON-LD events: a page that marks its events up as schema.org Event
//     (Wix event pages — Historic Downtown Snohomish — and Songkick's venue
//     page, the Historic Everett Theatre's stand-in while its own site is
//     down). startDate is the venue's wall-clock time, with or without an
//     offset; `at` keeps only events whose location names the place, since
//     Songkick pads a venue page with other rooms' shows. ---
export function parseJsonLdEvents(html, { venue, at, titleStrip }) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    for (const o of (Array.isArray(j) ? j : [j])) {
      if (!o || !/Event/.test(String(o['@type']))) continue;
      const loc = typeof o.location === 'object' ? o.location?.name : o.location;
      if (at && !at.test(loc || '')) continue;
      const sd = String(o.startDate || '');
      if (!/^\d{4}-\d{2}-\d{2}/.test(sd)) continue;
      out.push({ venue, title: decodeEntities(o.name || '').replace(titleStrip || /$^/, '').replace(/\s+/g, ' ').trim(), date: sd.slice(0, 10), time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sd) ? `${sd.slice(11, 16)}:00` : '', url: String(o.url || '').split('?')[0] });
    }
  }
  return out;
}

// --- City of Mill Creek: a Drupal events list (millcreekwa.gov/events) of
//     name, "Saturday, October 10, 2026" and location; the clock time sits
//     on each event's own page ("10:30 a.m. - 11:30 a.m."). ---
export function parseMillCreekEvents(html, { venue, base = 'https://millcreekwa.gov' }) {
  const out = [];
  for (const m of String(html || '').matchAll(/event-list__item-name">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?event-list__item-date">\s*([^<]+)</g)) {
    const date = civicDate(m[3]);
    const title = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
    if (!date || isMeeting(title)) continue;
    out.push({ venue, title, date, time: '', url: new URL(m[1], base).href });
  }
  return out;
}
export function millCreekTime(html) {
  const text = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const main = text.slice(Math.max(0, text.search(/event-detail|field--name-field-date|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/i)));
  return civicTime(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/i.exec(main)?.[0]);
}

const SB_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const sbPad = (n) => String(n).padStart(2, '0');

// "8:00 p.m." → "20:00:00"; anything unparseable → '' (all-day)
export function parseClockTime(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${sbPad(h)}:${m[2]}:00`;
}

/**
 * Showbox Presents (showboxpresents.com/events/all): AEG's listing for its
 * Northwest rooms, server-rendered — one `div.entry` per show with the
 * headliner (h3), a "with …" support line (h4), "Tue, Oct 6, 2026", "Show
 * 8:00 PM", the room after an "@" and the AXS ticket button, whose text
 * says when a show is postponed, cancelled or sold out. Only the two Seattle
 * rooms are kept (the same page lists WAMU, the Crystal Ballroom and a dozen
 * more); "The Showbox" is the Market room. Ticketmaster carries these nights
 * only as resale offers, so this is the box office. Returns [{ venue,
 * title, date, time, url, status?, soldOut? }].
 */
const SHOWBOX_ROOMS = { 'Showbox SoDo': 'Showbox SoDo' }; // only the SoDo room is in Pioneer Square's reach; the Market room is lqa's
export function parseShowboxEvents(html) {
  const out = [];
  for (const entry of String(html).split(/<div class="entry /).slice(1)) {
    const seg = entry.replace(/\s+/g, ' ');
    const room = seg.match(/<span class="venue">.*?<\/span>\s*([^<]+)<\/span>/);
    const venue = room && SHOWBOX_ROOMS[room[1].trim()];
    if (!venue) continue;
    const h3 = seg.match(/<h3[^>]*>\s*<a[^>]*>\s*([^<]*?)\s*<\/a>/);
    const dm = seg.match(/<span class="date">.*?<\/span>\s*(?:[A-Za-z]{3},\s*)?([A-Za-z]+)\.? (\d{1,2}), (\d{4})\s*</);
    if (!h3 || !dm) continue;
    const mon = SB_MONTHS[Object.keys(SB_MONTHS).find((k) => k.startsWith(dm[1].slice(0, 3).toLowerCase()))];
    if (!mon) continue;
    let title = decodeEntities(h3[1]);
    const h4 = seg.match(/<h4[^>]*>([^<]+)<\/h4>/);
    const support = h4 && decodeEntities(h4[1]).trim();
    if (support && /^with /i.test(support)) title += ` ${support}`;
    const tm = seg.match(/<span class="time">.*?<\/span>\s*(?:Show|Doors)?\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    const tickets = seg.match(/href="([^"]+)"[^>]*class="btn-tickets[^"]*"[^>]*>(?:<i[^>]*><\/i>)?\s*([^<]*)</);
    const detail = seg.match(/href="(https?:\/\/www\.showboxpresents\.com\/events\/detail\/\d+)"/);
    const ev = {
      venue, title,
      date: `${dm[3]}-${sbPad(mon)}-${sbPad(dm[2])}`,
      time: tm ? parseClockTime(tm[1]) : '',
      url: (tickets && tickets[1]) || (detail && detail[1]) || 'https://www.showboxpresents.com/events',
    };
    const word = tickets ? tickets[2].trim().toLowerCase() : '';
    if (/postponed|rescheduled/.test(word)) ev.status = 'postponed';
    else if (/cancel/.test(word)) ev.status = 'cancelled';
    else if (/sold out/.test(word)) ev.soldOut = true;
    out.push(ev);
  }
  return out;
}

// ---- Baba Obscura: Baba Yaga & Desert Daze's roving festival (Nov 2026) ----
// The schedule page carries one schema.org MusicEvent per set (the act, its
// stage, UTC start and end, and "Thu 11/5" — the festival night — in the
// description), each with the Festival as its superEvent. A night past
// midnight stays on its festival night in the grid; the set's own row sits on
// its calendar date. Returns the nights: { date: [{ stage, act, start, end, at }] }.
export const BABA_OBSCURA_URL = 'https://babaobscura.com/schedule';
const nextDate = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
// "Axis Pioneer Square (North Stage)" → "Axis North", as the festival's stages page names them
const stageName = (s) => { const m = s.match(/^Axis\b.*\((North|South) Stage\)/i); return m ? `Axis ${m[1]}` : s; };
const LA_PARTS = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
export function parseBabaObscuraSchedule(html) {
  const nights = {}, seen = new Set();
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    for (const g of [].concat(data['@graph'] || data)) {
      if (g['@type'] !== 'MusicEvent' || !/baba obscura/i.test(g.superEvent?.name || '') || !g.startDate) continue;
      const act = (g.performer?.name || g.name.replace(/ at Baba Obscura.*$/i, '')).trim(), stage = (g.location?.name || '').trim();
      const k = `${act}|${stage}|${g.startDate}`; if (seen.has(k)) continue; seen.add(k);
      const start = LA_PARTS(g.startDate), end = g.endDate ? LA_PARTS(g.endDate) : null;
      // the night: "… Thu 11/5 at 18:00." — the year from the start
      const n = (g.description || '').match(/\b(\d{1,2})\/(\d{1,2}) at \d/);
      const night = n ? `${start.date.slice(0, 4)}-${n[1].padStart(2, '0')}-${n[2].padStart(2, '0')}` : start.date;
      // the site dates a set past midnight on its night's own morning (Rose City Band, "Fri 11/6 at 00:00", is
      // 2026-11-06T08:00Z) — a start before 6 AM belongs to the morning after the night
      const at = start.date <= night && start.time < '06:00' ? nextDate(night) : start.date;
      (nights[night] = nights[night] || []).push({ stage: stageName(stage), act, start: start.time, end: end ? end.time : '', at });
    }
  }
  for (const d of Object.keys(nights)) nights[d].sort((a, b) => (a.at + a.start).localeCompare(b.at + b.start));
  return nights;
}

// The nights → rows. The festival is its own venue (the Festivals group): a
// row a night, titled with the billed headliners playing it (else the act
// closing the night), the whole bill as `lineup` and the grid as `sets`. And
// each set at its own venue (`stageVenue`, the city's name for that room, or
// null where the city doesn't list it), stage named, `set: true`, `fest`
// marking it for festivalOwnsNights. Headliners are lowercase names.
export function babaObscuraRows(nights, { headliners = [], stageVenue = () => null, url = BABA_OBSCURA_URL, tickets = 'https://babaobscura.com/tickets' } = {}) {
  const out = [];
  for (const [date, list] of Object.entries(nights).sort()) {
    const stages = [];
    for (const s of list) { let st = stages.find((x) => x.stage === s.stage); if (!st) stages.push(st = { stage: s.stage, acts: [] }); st.acts.push({ act: s.act, start: s.start, ...(s.end ? { end: s.end } : {}) }); }
    const billed = list.filter((s) => headliners.includes(s.act.toLowerCase())).map((s) => s.act);
    const title = (billed.length ? [...new Set(billed)].reverse() : [list[list.length - 1].act]).join(', ');
    out.push({ venue: 'Baba Obscura', type: 'concert', url, date, time: list[0].start, title, lineup: list.map((s) => s.act), sets: stages });
    for (const s of list) {
      const venue = stageVenue(s.stage); if (!venue) continue;
      const room = s.stage.replace(/^Baba Yaga |^Axis /, ''); // "Up", "Down", "North", "South" — the room's own name is the venue
      out.push({ venue, type: 'concert', url: tickets, date: s.at, time: s.start, ...(s.end ? { end: s.end } : {}), title: s.act,
        stage: 'Baba Obscura' + (room !== s.stage ? ` · ${room} stage` : ''), set: true, fest: 'Baba Obscura' });
    }
  }
  return out;
}

// A festival owns its nights at the venues it plays: on a night it has sets
// at a venue, that venue's own "Baba Obscura" placeholder rows give way, and
// a set the venue already lists (its act named in the venue's own title —
// the Showbox's "The Black Angels with GHOSTWOMAN") is left to the venue's row.
export function festivalOwnsNights(rows, name = 'Baba Obscura') {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const sets = rows.filter((e) => e.fest === name), at = new Set(sets.map((e) => `${e.venue}|${e.date}`));
  const own = rows.filter((e) => e.fest !== name && e.venue !== name);
  return rows.filter((e) => {
    if (e.fest === name) return !own.some((o) => o.venue === e.venue && o.date === e.date && !re.test(o.title || '') && (o.title || '').toLowerCase().includes(e.title.toLowerCase()));
    return !(at.has(`${e.venue}|${e.date}`) && re.test(e.title || ''));
  }).map((e) => { if (e.fest !== name) return e; const { fest, ...r } = e; return r; });
}

// ---- T-Mobile Park's own events page (lqa-events' reader, copied 2026-10-31: every venue from Ticketmaster AND its own site) ----
const mlbPad = (n) => String(n).padStart(2, '0');
/**
 * The Mariners' events page (mlb.com/mariners/tickets/events) is a Next.js page: its
 * __NEXT_DATA__ blob holds the page as nested content blocks, and each non-baseball event the
 * club sells itself is a `featured-content` block linking under /mariners/tickets/events/ (Banana
 * Ball, 2026-10-26: "Banana Ball is coming the T-Mobile Park in Seattle, WA on April 23 & 24,
 * 2027."). Returns [{ url, alt }], one per event page, in page order, each page once.
 */
const MLB = 'https://www.mlb.com';
function nextData(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export function parseMarinersIndex(html) {
  const data = nextData(html);
  const out = []; const seen = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.type === 'featured-content') {
      const path = o.media?.url || o.url || '';
      if (/^\/mariners\/tickets\/events\/[^/?#]+/.test(path) && !seen.has(path)) { seen.add(path); out.push({ url: MLB + path, alt: String(o.media?.altText || '') }); }
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return out;
}
/**
 * One event's page → rows. The title and dates come from a heading "<Event> at T-Mobile Park on
 * April 23 & 24" (the year from the first "April 23 & 24, 2027" in the page's text, else the
 * index card's alt text, else the next such date forward); "April 23 & 24", "April 23-24" and
 * "April 23, 24 & 25" are one row a day. The ticket link is the page's lottery or ticket link
 * (fansfirsttickets.com, tickets.com, ticketmaster) when it has one, else the page itself.
 * No clock: the page prints none.
 */
export function parseMarinersEvent(html, { url: pageUrl = '', alt = '' } = {}, today = new Date()) {
  const data = nextData(html);
  const text = data ? JSON.stringify(data) : String(html || '');
  const heads = []; const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.type === 'heading' && o.headingText) heads.push(String(o.headingText)); Object.values(o).forEach(walk); } };
  walk(data);
  const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December)';
  const head = heads.map((h) => new RegExp(`^(.+?) at T-Mobile Park on ${MONTH}\\s+([\\d,&\\s-]+?)\\s*$`, 'i').exec(h.replace(/\s+/g, ' ').trim())).find(Boolean);
  if (!head) return [];
  const [, title, month, daysText] = head;
  const days = (daysText.match(/\d{1,2}/g) || []).map(Number);
  const ym = new RegExp(`${month}\\s+\\d{1,2}[^.]{0,20}?,?\\s*(20\\d\\d)`, 'i').exec(text) || new RegExp(`${month}\\s+\\d{1,2}[^.]{0,20}?,?\\s*(20\\d\\d)`, 'i').exec(alt);
  const mo = SB_MONTHS[month.toLowerCase()];
  let year = ym ? Number(ym[1]) : today.getUTCFullYear();
  if (!ym && Date.UTC(year, mo - 1, days[0] || 1) < Date.now() - 31 * 86400e3) year += 1;
  // the lottery link first (fansfirsttickets.com), then a ticket page; never the club's account manager (am.ticketmaster.com)
  const link = /https?:\/\/[^"'\\\s]*fansfirsttickets\.com[^"'\\\s]*/.exec(text) || /https?:\/\/(?!am\.)[^"'\\\s]*(?:tickets\.com|ticketmaster\.com)[^"'\\\s]*/.exec(text);
  const ticket = link ? link[0].replace(/\\u0026/g, '&') : pageUrl;
  return days.map((d) => ({ venue: 'T-Mobile Park', title: title.trim(), date: `${year}-${mlbPad(mo)}-${mlbPad(d)}`, time: '', url: ticket, type: 'sports' }));
}
