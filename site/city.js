// The city — every fact that makes this calendar Pioneer Square's rather than
// another neighbourhood's, in one place (2026-10-15: a sister of lqa-events,
// the second Seattle neighbourhood after Lower Queen Anne). The browser
// (filter.js, app.js) and the build (scripts/*.mjs) both read it; nothing
// else names a venue or a team. The shared files (app.js, filter.js,
// styles.css bar its --v-* hues, scripts/*.mjs bar fetch-events.mjs and
// sources.mjs) are lqa-events' own, byte for byte — see README "Sister sites".
//
// Pioneer Square: Seattle's first neighbourhood, the brick blocks between
// the waterfront, Yesler Way and the stadiums. Its rooms are small and few
// sell through Ticketmaster — Baba Yaga and the Central Saloon are club
// shows, the Jazz Fellowship a listening room, Trinity a nightclub, Nordo a
// dinner theatre — so most of the listing is read from the rooms' own
// pages; the Alliance for Pioneer Square's neighbourhood calendar fills in
// the galleries, markets and walks. Lumen Field, T-Mobile Park, WAMU and
// Showbox SoDo are a few blocks south and have their own group.
//
// Loaded before filter.js (a plain script, so the tests can share it): it
// sets globalThis.LQACity (the name is the shared code's, not the city's).
(function (global) {
  'use strict';

  // The home teams, matched on the event title whatever the venue. Order =
  // the Teams strip, left to right. The six Seattle clubs: the Seahawks,
  // Sounders and Reign play at Lumen Field and the Mariners at T-Mobile
  // Park, both rooms here, so their home games arrive through Ticketmaster
  // like any other night (no `inject`); the Kraken and Storm play at
  // Climate Pledge Arena, up in Lower Queen Anne, so they are Teams-view-only.
  // Per team:
  //   re        the title match
  //   venue     the home building; schedule = the club's own schedule page
  //   sport     keys the strip icon (app.js SPORT_ICONS), the game clock,
  //             the leader categories
  //   colors    [primary, accent] — the season calendar's home cells and
  //             card frames
  //   espn      ESPN's sport/league/team id — the season, the form block,
  //             news and transactions (schedules.mjs); the Mariners' season
  //             comes from MLB's stats API and the Kraken's from the NHL's
  //   division  (baseball) the division rivals by the abbreviations the
  //             schedule carries, for the standings line
  //   club      the club's name on Ticketmaster; news the outlets' feeds;
  //             wiki the article; opens when the season usually starts
  // The entries are lqa-events' verbatim — keep them in step.
  var ST = function (s) { return ['https://www.seattletimes.com/sports/' + s + '/feed/', 'Seattle Times']; }; // the Seattle clubs' beat
  var TEAMS = [
    { slug: 'seahawks', label: 'Seahawks', re: /seahawks/i, sport: 'football', venue: 'Lumen Field', colors: ['#002244', '#69be28'],
      espn: { sport: 'football', league: 'nfl', id: '26' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png', schedule: 'https://www.seahawks.com/schedule/',
      club: 'Seattle Seahawks', opens: 'September', wiki: { title: 'Seattle Seahawks', startYear: true },
      news: [ST('seahawks'), ['https://www.seahawks.com/rss/news', 'Seahawks.com'], ['https://www.fieldgulls.com/rss/current.xml', 'Field Gulls']],
      youtube: ['UCzkFCRiMcOBeef8xcaqipmw', 'UCDVYQ4Zhbm3S2dlz7P1GBDg'] }, // @Seahawks, @NFL
    { slug: 'mariners', label: 'Mariners', re: /mariners/i, sport: 'baseball', venue: 'T-Mobile Park', colors: ['#0c2c56', '#005c5c'],
      espn: { sport: 'baseball', league: 'mlb', id: '12' }, season: { kind: 'mlb', id: 136 }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png', schedule: 'https://www.mlb.com/mariners/schedule',
      club: 'Seattle Mariners', opens: 'late March', wiki: { title: 'Seattle Mariners' },
      division: ['HOU', 'LAA', 'ATH', 'TEX'], // AL West, by the abbreviations the schedule carries (ATH since the Athletics left Oakland)
      news: [ST('mariners'), ['https://www.mlb.com/mariners/feeds/news/rss.xml', 'MLB.com'], ['https://www.lookoutlanding.com/rss/current.xml', 'Lookout Landing']],
      youtube: ['UCWWLs-O8JGYYcNea7AgumAA'] }, // @mariners (MLB's clips come from statsapi)
    { slug: 'kraken', label: 'Kraken', re: /kraken/i, sport: 'hockey', venue: 'Climate Pledge Arena', colors: ['#001628', '#99d9d9'],
      espn: { sport: 'hockey', league: 'nhl', id: '124292' }, season: { kind: 'nhl', abbrev: 'SEA' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png', schedule: 'https://www.nhl.com/kraken/schedule',
      club: 'Seattle Kraken', opens: 'early October', wiki: { title: 'Seattle Kraken' },
      news: [ST('kraken'), ['https://soundofhockey.com/feed/', 'Sound Of Hockey'], ['https://www.davyjoneslockerroom.com/rss/current.xml', "Davy Jones' Locker Room"]],
      youtube: ['UCxspiBq2xf5pLjz9_NMjoyw'] }, // @seattlekraken (the NHL's clips come from api-web)
    { slug: 'storm', label: 'Storm', re: /seattle storm/i, sport: 'basketball', venue: 'Climate Pledge Arena', colors: ['#2c5234', '#fee11a'],
      espn: { sport: 'basketball', league: 'wnba', id: '14' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/wnba/500/sea.png', schedule: 'https://storm.wnba.com/schedule/',
      club: 'Seattle Storm', opens: 'May', wiki: { title: 'Seattle Storm' },
      news: [ST('storm')],
      youtube: ['UCv4xLXLA_aElluuaTWXN1jA', 'UCO9a_ryN_l7DIDS-VIt-zmw'] }, // @SeattleStormOfficial, @WNBA
    { slug: 'reign', label: 'Reign', re: /reign fc|seattle reign/i, sport: 'soccer', venue: 'Lumen Field', colors: ['#0a2240', '#c5a05a'],
      espn: { sport: 'soccer', league: 'usa.nwsl', id: '15363' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15363.png', schedule: 'https://www.reignfc.com/schedule',
      club: 'Seattle Reign', opens: 'March', wiki: { title: 'Seattle Reign FC' },
      news: [ST('reign')],
      youtube: ['UCokzki4ovbASTy0MGok5DpQ', 'UCL4xu08EDu0ZFZsBJUB0chw'] }, // @reignfc, @nwslsoccer
    { slug: 'sounders', label: 'Sounders', re: /sounders/i, sport: 'soccer', venue: 'Lumen Field', colors: ['#236192', '#5d9741'],
      espn: { sport: 'soccer', league: 'usa.1', id: '9726' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png', schedule: 'https://www.soundersfc.com/schedule/',
      club: 'Seattle Sounders', opens: 'late February', wiki: { title: 'Seattle Sounders FC' },
      news: [ST('sounders'), ['https://www.sounderatheart.com/feed', 'Sounder at Heart']],
      youtube: ['UCVhbRUhe_hfmgi-UN1gcQzw', 'UCSZbXT5TLLW_i-5W8FZpFsg'] }, // @SoundersFC, @MLS
  ];

  // The venues. Keys are the display names the feeds are folded to. Per venue:
  //   area     'town' = SoDo and the stadiums, south of King Street (the
  //            panel's second group); unmarked = Pioneer Square itself
  //   capacity the Capacity rows' thresholds (the share-code 'cap' bits)
  //   type     the default event type when the feed names none
  //   cssVar   the hue in styles.css (light and dark values live there);
  //            color is the light one for the places that read it directly
  //   url      the room's own events page (the sheet's venue link)
  //   icon     the favicon, through Google's cache
  //   tm       the Ticketmaster venue id and the name test (every page is
  //            read; `match` is a lower-case substring of the venue's TM
  //            name); exclude drops tours and memberships; fallbackUrl when
  //            a listing has no link of its own
  //   feed     the room's own calendar, read by scripts/feeds.mjs by `kind`
  //   alias    the other spellings the feeds use for it, folded to this name
  var VENUES = {
    'Baba Yaga': { // 124 S Washington St — the cocktail bar with a stage: shows on TicketWeb, karaoke and trivia on ma.to
      capacity: 200,
      type: 'concert',
      cssVar: '--v-baba',
      color: '#ea8686',
      url: 'https://babayagaseattle.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=babayagaseattle.com&sz=128',
      tm: { id: 'rZ7HnEZ17jbAS', match: 'baba yaga', fallbackUrl: 'https://babayagaseattle.com/events' },
      // no soldOut tag: its TicketWeb pages answer 506 to a plain fetch and a bare page to a browser-impersonating one (2026-10-15), so there is no status to read
      // the bar's own site says "we are updating our events" (SpotHopper, empty API); ma.to's venue page carries the weekly nights as schema.org Events
      feed: { kind: 'jsonld', url: 'https://ma.to/venue/babayagaseattle', drop: /taco tuesday/i },
      alias: /baba yaga/i,
    },
    'Central Saloon': { // 207 1st Ave S, Seattle's oldest bar (1892) and a 300-cap club; its own WordPress calendar
      capacity: 300,
      type: 'concert',
      cssVar: '--v-central',
      color: '#eab486',
      url: 'https://centralsaloon.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=centralsaloon.com&sz=128',
      // Modern Events Calendar list: its JSON-LD has the dates but no clocks, so the cards are read (date span + time span); TM KovZpZA1kaJA is empty
      feed: { kind: 'cards', url: 'https://centralsaloon.com/events/', item: /<article class="mec-event-article/, title: /class="mec-event-title"><a[^>]*href="([^"]+)"[^>]*>([^<]+)</, when: /mec-start-date-label">([^<]+)<\/span>[\s\S]{0,800}?mec-start-time">([^<]+)</ },
      alias: /central saloon/i,
    },
    'Seattle Jazz Fellowship': { // 109 S Washington St — the listening room, five nights a week; Squarespace
      capacity: 100,
      type: 'concert',
      cssVar: '--v-sjf',
      color: '#eadb86',
      url: 'https://seattlejazzfellowship.org/events',
      icon: 'https://www.google.com/s2/favicons?domain=seattlejazzfellowship.org&sz=128',
      feed: { kind: 'squarespace', url: 'https://seattlejazzfellowship.org/events' },
      alias: /jazz fellowship/i,
    },
    'Trinity Nightclub': { // 111 Yesler Way — three rooms, the weekend parties on Eventbrite
      capacity: 1000,
      type: 'concert',
      cssVar: '--v-trinity',
      color: '#c486ea',
      url: 'https://www.trinitynightclub.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.trinitynightclub.com&sz=128',
      feed: { kind: 'linked', url: 'https://www.trinitynightclub.com/', match: /eventbrite\.com\/e\//, max: 40 },
      alias: /trinity nightclub|trinity seattle/i,
    },
    'Nordo': { // Café Nordo's Culinarium, 109 S Main St — dinner theatre; Squarespace calendar
      capacity: 100,
      type: 'arts',
      cssVar: '--v-nordo',
      color: '#ea86c8',
      url: 'https://www.cafenordo.com/calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.cafenordo.com&sz=128',
      feed: { kind: 'squarespace', url: 'https://www.cafenordo.com/calendar' },
      alias: /caf[eé] nordo|nordo'?s? culinarium|culinarium/i,
    },
    'Occidental Square': { // the park — markets, the flea, the art walk; the Downtown Seattle Association programs it
      capacity: 2000,
      type: 'community',
      cssVar: '--v-occidental',
      color: '#86ea9a',
      url: 'https://www.downtownseattle.org/places/occidental-square/',
      icon: 'https://www.google.com/s2/favicons?domain=www.downtownseattle.org&sz=128',
      feed: { kind: 'tribe', url: 'https://www.downtownseattle.org/wp-json/tribe/events/v1/events?venue=53729' },
      alias: /occidental (square|park)/i,
    },
    "Owl 'n Thistle": { // 808 Post Ave — the Irish pub with music most nights; its site prints a weekly schedule, no dates, so the build writes the week out (fetch-events.mjs)
      capacity: 100,
      type: 'concert',
      cssVar: '--v-owl',
      color: '#b8ea86',
      url: 'https://owlnthistle.com/live-music-schedule',
      icon: 'https://www.google.com/s2/favicons?domain=owlnthistle.com&sz=128',
      alias: /owl ?'?n'? ?thistle/i,
    },
    'Klondike Gold Rush NHP': { // 319 2nd Ave S — the National Park Service's Seattle unit, in the Cadillac Hotel: ranger talks, Living Voices
      capacity: 100,
      type: 'community',
      cssVar: '--v-klondike',
      color: '#eac786',
      url: 'https://www.nps.gov/klse/planyourvisit/calendar.htm',
      icon: 'https://www.google.com/s2/favicons?domain=www.nps.gov&sz=128',
      feed: { kind: 'nps', url: 'https://developer.nps.gov/api/v1/events?parkCode=klse' },
      alias: /klondike|cadillac hotel/i,
    },
    'Around Pioneer Square': { // everything else the Alliance's neighbourhood calendar lists — galleries, museums, walks, pop-ups (groundsVenue)
      capacity: 500,
      type: 'community',
      cssVar: '--v-around',
      color: '#86d9ea',
      url: 'https://pioneersquare.org/events/',
      icon: 'https://www.google.com/s2/favicons?domain=pioneersquare.org&sz=128',
    },
    'Lumen Field': {
      capacity: 68700,
      area: 'town',
      type: 'concert',
      cssVar: '--v-lumen',
      color: '#8b8fe8',
      url: 'https://www.lumenfield.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.lumenfield.com&sz=128',
      tm: { id: 'KovZpZAEknnA', match: 'lumen field', fallbackUrl: 'https://www.lumenfield.com/events', exclude: /stadium tour|notification list/i },
      soldOut: 'tm',
    },
    'T-Mobile Park': {
      capacity: 47900,
      area: 'town',
      type: 'concert',
      cssVar: '--v-tmobile',
      color: '#8ad8e0',
      url: 'https://www.mlb.com/mariners/ballpark/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.mlb.com&sz=128',
      tm: { id: 'KovZpZAEevAA', match: 't-mobile park', fallbackUrl: 'https://www.mlb.com/mariners', exclude: /ballpark tour|flex membership/i },
      soldOut: 'tm',
    },
    'WAMU Theater': { // inside Lumen Field's event centre, 7,000 standing
      capacity: 7000,
      area: 'town',
      type: 'concert',
      cssVar: '--v-wamu',
      color: '#a6a1ea',
      url: 'https://www.wamutheater.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.wamutheater.com&sz=128',
      tm: { id: 'KovZpZAFFE7A', match: 'wamu', fallbackUrl: 'https://www.wamutheater.com/', exclude: /amplified access|parking/i },
      alias: /wamu theat/i,
    },
    'Waterfront Park': { // Pier 62 and the new park along Alaskan Way, a ten-minute walk west — Friends of Waterfront Park's tours, films, dances and markets, from the cards on its events page
      capacity: 2000,
      type: 'community',
      cssVar: '--v-waterfront',
      color: '#86c9ea',
      area: 'town',
      url: 'https://waterfrontparkseattle.org/events/',
      icon: 'https://www.google.com/s2/favicons?domain=waterfrontparkseattle.org&sz=128',
      feed: { kind: 'cards', url: 'https://waterfrontparkseattle.org/events/',
        item: /<div class="grid-item"/, title: /<a href="([^"]+)">[\s\S]*?<h4 class="widont ">([\s\S]*?)<\/h4>/,
        when: /<h3 class="widont ">([\s\S]*?)<\/h3><h3 class="widont date-time">([^<]*)<\/h3>/ },
      alias: /waterfront park|pier 62/i,
    },
    'Showbox SoDo': { // AEG's 1,800-cap room on 1st Ave S; box office on AXS, read from showboxpresents.com (Ticketmaster has only resale)
      capacity: 1800,
      area: 'town',
      type: 'concert',
      cssVar: '--v-sodo',
      color: '#aab8d6',
      url: 'https://www.showboxpresents.com/events/all',
      icon: 'https://www.google.com/s2/favicons?domain=www.showboxpresents.com&sz=128',
      alias: /showbox sodo/i,
    },
  };

  // City-wide feeds — listings that name their rooms, folded by `alias` or
  // into groundsVenue. The Alliance for Pioneer Square's calendar
  // (pioneersquare.org/events): a custom theme with no API, so the page is
  // cut into cards (scripts/feeds.mjs `cards`).
  var FEEDS = [
    { kind: 'cards', label: 'Alliance for Pioneer Square', url: 'https://pioneersquare.org/events/', type: 'community',
      item: /<div class="grid-item"/, title: /<h3><a href="([^"]+)">([^<]+)<\/a>/, when: /<strong>([^<]+)<\/strong>/, place: /<\/strong><\/p>\s*<p>([^<]*)<\/p>/,
      drop: /office hours/i }, // the Alliance's own drop-in hours are not events
    // First Thursday Art Walk — the Alliance lists each month's walk on its own page, dated but with no clock (5 to 8 PM every first Thursday)
    { kind: 'cards', label: 'First Thursday Art Walk', url: 'https://pioneersquare.org/art-walks/', type: 'arts', time: '17:00',
      item: /<div class="grid-item"/, title: /<h3><a href="([^"]+)">([^<]+)<\/a>/, when: /<strong>([^<]+)<\/strong>/ },
  ];

  // The filter panel's starting state: every room on, nothing off.
  var DEFAULT_ON = ['Baba Yaga', 'Central Saloon', 'Seattle Jazz Fellowship', 'Trinity Nightclub', 'Nordo', 'Occidental Square', "Owl 'n Thistle", 'Klondike Gold Rush NHP', 'Around Pioneer Square', 'Lumen Field', 'T-Mobile Park', 'WAMU Theater', 'Showbox SoDo', 'Waterfront Park'];
  var DEFAULT_OFF = [];
  var PREFS_KNOWN_FROM = null; // no default-off venue yet, so nothing for saved prefs to be told about

  // The event types (the panel's Event Type rows; badges.mjs assigns them).
  var TYPES = [
    { key: 'concert', label: 'Concerts', title: 'Live music and club nights — Baba Yaga, the Central, the Jazz Fellowship, Trinity, Showbox SoDo, WAMU' },
    { key: 'sports', label: 'Sports', title: 'Seahawks, Sounders and Reign at Lumen Field, Mariners at T-Mobile Park' },
    { key: 'arts', label: 'Arts & Theater', title: 'Nordo, the galleries, First Thursday' },
    { key: 'community', label: 'Community', title: 'Occidental Square markets, walks, pop-ups, the neighbourhood calendar' },
  ];
  var MOVIE_VENUE = null; // no cinema here

  // Share codes (?f=CODE): REGISTRY is every filterable key in a fixed
  // order and a code is a bitmask over it, so the list is APPEND-ONLY —
  // adding an entry adds a bit and every existing code keeps meaning what
  // it meant; removing or reordering one changes every link out there.
  // 25 slots from the first build, three rooms appended the same afternoon (28): six base-36 digits
  // (five hold 25 bits; the 26th needs the sixth).
  var CODE_LENGTH = 6;
  var REGISTRY = [
    ['venue', 'Baba Yaga'], ['venue', 'Central Saloon'], ['venue', 'Seattle Jazz Fellowship'], ['venue', 'Trinity Nightclub'], ['venue', 'Nordo'], ['venue', 'Occidental Square'], ['venue', 'Around Pioneer Square'],
    ['venue', 'Lumen Field'], ['venue', 'T-Mobile Park'], ['venue', 'WAMU Theater'], ['venue', 'Showbox SoDo'],
    ['badge', 'concert'], ['badge', 'sports'], ['badge', 'arts'], ['badge', 'community'],
    ['team', 'seahawks'], ['team', 'mariners'], ['team', 'kraken'], ['team', 'storm'], ['team', 'reign'], ['team', 'sounders'],
    ['cap', 'stadium'], ['cap', 'arena'], ['cap', 'hall'], ['cap', 'room'],
    // appended 2026-10-15 afternoon (the registry is append-only: old share codes keep their meaning)
    ['venue', "Owl 'n Thistle"], ['venue', 'Klondike Gold Rush NHP'], ['venue', 'Waterfront Park'],
  ];

  var WORDS = {
    teamCity: 'Seattle', // the board drops it from the clubs' names ("Seattle Kraken" → Kraken)
    presetDefault: 'Every room — Pioneer Square and the stadiums — every team and type',
    presetNeighborhood: 'Pioneer Square only — Baba Yaga, the Central, the Jazz Fellowship, Trinity, Nordo, the Owl, Klondike, Occidental Square',
    presetBig: 'Only the places that hold 2,000 or more — Lumen Field, T-Mobile Park and WAMU',
    phrases: { all: 'Showing everything.', none: 'Showing nothing yet — open Filter and pick some venues.', neighborhood: 'Showing Pioneer Square only.', big: 'Showing the big rooms only — the stadiums and WAMU.' },
  };

  global.LQACity = {
    key: 'pioneersquare',
    name: 'Pioneer Square',
    site: 'https://pioneersquare.seattle.here.events/', // a neighbourhood sits under its city (Steve, 2026-10-11)
    userAgent: 'Mozilla/5.0 (compatible; pioneersquare-events/1.0; +https://pioneersquare.seattle.here.events/)',
    tz: 'America/Los_Angeles', tzName: 'Pacific', // the city's time zone: the ICS feed's TZID, the game clocks, the poster's footer
    state: "Washington", stateOutline: 'M6.9 5.6L9.4 5.6L12.6 5.6L15.9 5.6L19.2 5.6L21.6 5.6L21.6 7.4L21.6 9.2L21.7 11.0L21.7 12.8L21.7 14.7L21.6 15.4L21.9 16.3L22.0 16.9L20.0 16.9L18.0 16.9L16.6 16.9L15.5 17.1L13.2 17.9L11.0 18.2L9.8 18.0L8.6 18.4L7.5 18.3L7.0 17.8L6.3 16.3L5.7 16.3L5.2 15.9L4.1 15.9L3.7 15.5L3.8 14.9L4.1 14.4L3.5 13.6L3.7 13.0L3.5 13.3L3.3 12.3L2.6 10.1L2.0 8.7L2.2 7.9L3.6 8.6L5.7 8.9L6.3 9.0L6.7 9.0L7.0 9.0L7.3 9.8L6.9 10.1L6.0 11.4L6.1 11.8L6.6 11.5L6.2 11.4L6.6 10.8L7.1 10.2L7.4 9.6L7.6 10.0L7.3 10.5L7.2 10.8L7.5 11.4L7.4 12.1L7.1 12.0L6.9 11.9L6.5 12.2L6.6 12.6L7.1 12.7L7.5 12.1L7.9 11.9L8.0 11.1L7.9 10.6L8.0 10.3L8.1 9.7L8.3 9.2L7.9 8.7L7.9 9.0L7.6 8.7L7.7 8.3L7.7 7.9L7.3 7.7L7.3 7.5L7.7 7.4L7.6 6.8L7.5 6.4L7.2 6.3Z', // the masthead's small state, linking to here.events (scripts/state-outline.mjs, Natural Earth 1:50m)
    ics: { name: 'Pioneer Square Events', short: 'Pioneer Square Events', teams: 'Seattle home teams — every season', prodid: '-//here.events//pioneersquare-events//EN', uidDomain: 'fosdal.net', // the UID domain the whole family issues (the shared ics test pins it)
      desc: 'Upcoming events in Pioneer Square\\, Seattle — the clubs\\, the Jazz Fellowship\\, Occidental Square and the stadiums\\, with the Seattle clubs\' seasons' },
    teams: TEAMS,
    venues: VENUES,
    feeds: FEEDS,
    defaultOn: DEFAULT_ON,
    defaultOff: DEFAULT_OFF,
    prefsKnownFrom: PREFS_KNOWN_FROM,
    types: TYPES,
    movieVenue: MOVIE_VENUE,
    groundsVenue: 'Around Pioneer Square', // the Alliance calendar's rooms that are not rows of their own
    codeLength: CODE_LENGTH,
    registry: REGISTRY,
    words: WORDS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
