# Regression: BKE-4D Basketball Summary Authority

Status: BKE-4D1 through BKE-4D4 are implemented. No migration is required. The full live/manual
matrix remains release evidence, and Basketball event-game creation remains internal through
BKE-4E.

## BKE-4D1 Automated Gate

Run:

```powershell
pnpm test
pnpm build
pnpm lint
```

Coverage verifies:

- local event review rebuilds from the mounted stream without reading cloud state;
- direct non-final review loads only the effective primary into an isolated page-local source;
- manager-selected alternate review replaces the entire source and never blends recorders;
- limited recorder metadata cannot unlock alternate review;
- cloud-final event games require one healthy canonical publication and never fall back;
- invalid and unshipped tabs normalize to Overview through the explicit Basketball route marker;
- period scores derive from active scoring events and score adjustments;
- team comparisons use authoritative side totals and leaders retain every nonzero tie; and
- legacy Basketball remains on the aggregate Summary path after the setup-snapshot authority
  probe proves that no event setup exists.

## Focused Runtime Check

1. Open a local marked Basketball event game and confirm Summary shows `This device` without
   changing the parked-game manifest.
2. Open a non-final marked cloud game from Cloud Games and confirm Summary shows the primary
   recorder; a viewer/scorer must not see manager-only recorder details.
3. As a personal creator or team owner/admin with at least two streams, select an alternate and
   confirm its score/totals replace the primary rather than combining with it.
4. Finalize through Game Info, open Summary, and confirm the header says `Official final` and uses
   the canonical score. Reopen through Game Info and confirm the stale final cannot remain active.
5. Open a representative legacy Basketball final and confirm the existing aggregate Summary still
   loads.
6. At phone and desktop widths, confirm names, scores, source selection, period table, comparison,
   leaders, retry, and Game Info recovery controls remain readable and keyboard operable.

The combined BKE-4B/BKE-4C two-device matrix remains separate release evidence before event-game
creation is broadly enabled.

## BKE-4D2 Automated Gate

Coverage verifies:

- Players and Team Stats are valid URL tabs while Timeline and Shots still normalize to Overview;
- setup participants retain immutable order and valid late participants append by event order;
- tracked and explicit opponent participants receive independent rows without name-based merging;
- absent opponent participants produce no fabricated player rows while team totals remain visible;
- traditional points, shooting, rebounding, playmaking, defense, foul, and manual-minute values
  derive from the selected projection;
- FG%, 2PT%, 3PT%, FT%, eFG%, true shooting, and assist-to-turnover rates hide at zero denominator;
- team output uses authoritative side totals rather than summing visible participants;
- participant versus team/unknown attribution explains team turnovers and other unattributed
  activity without changing official totals;
- period score, team foul, bonus, charged timeout, neutral timeout, technical, disqualification,
  and ejection context remains projection-derived; and
- changing source remounts player side/detail state so review state cannot cross recorders.

## BKE-4D2 Focused Runtime Check

1. Open Players on tracked and opponent sides, including a game with no opponent participants and
   one with a late opponent participant.
2. Open player detail on phone and desktop, verify every traditional total and safe rate, then
   close with the button, backdrop, and Escape and confirm focus returns to the player row.
3. Compare Team Stats against the tracker for scoring, rebounds, assists, turnovers, fouls,
   timeouts, bonus, technicals, and ejections across regulation and overtime.
4. Record a team turnover or unknown-actor stat and confirm it appears in authoritative totals and
   Team / unknown attribution without being assigned to a player.
5. Switch between primary and an authorized alternate recording while on Players and Team Stats;
   confirm all rows replace rather than blend and local detail state resets.

## BKE-4D3 Automated Gate

Coverage verifies:

- Timeline is a valid URL-backed Summary tab while the unshipped Shot Chart still normalizes to
  Overview;
- the live tracker keeps newest-first capture review while Summary uses oldest-first capture order;
- Summary groups captures by period and uses deterministic stream-sequence labels;
- all overlapping BKE-3 event-family, period, side, and participant filters remain available;
- active capture groups, removed companions, current revisions, recorded-later context, and
  relationship warnings remain reviewable;
- only an explicitly editable in-progress/period-break authority can expose correction, while a
  read-only or terminal authority cannot; and
- source-key remounting isolates filter/detail state across local, primary, alternate, and
  canonical review.

Run:

```bash
pnpm exec vitest run src/lib/basketball/timeline.test.ts src/lib/basketball/summary.test.ts src/lib/basketball/summarySource.test.ts
pnpm lint
pnpm build
```

## BKE-4D3 Focused Runtime Check

1. Open Timeline from a healthy local event game and confirm Add/Edit/Remove/Restore match the
   existing tracker Timeline; suspend or complete the game and confirm mutation controls disappear.
2. Open primary, alternate, and canonical cloud sources and confirm the same event families and
   details render without any mutation controls.
3. Review active and removed multi-event capture groups, revised rows, and a recorded-later event;
   confirm period grouping and Capture labels stay deterministic without displaying capture time as
   elapsed game time.
4. Apply every family/period/side/participant filter, change authority, and confirm filters and open
   detail state reset rather than crossing recorder streams.
5. With a matching parked current-account binding, use Open owned recording and confirm the current
   game is parked only after confirmation, the owned binding resumes, and Tracker opens.
6. Use keyboard-only review for filters, rows, group disclosure, removed disclosure, details, and
   correction dialogs; close with Escape and confirm focus returns to the originating control.

## BKE-4D4 Automated Gate

Coverage verifies:

- Shot Chart is a valid URL-backed Summary tab and invalid tabs still normalize to Overview;
- active field goals derive from exactly one selected authority while free throws stay excluded;
- corrected located shots use shared court geometry and unlocated shots remain in totals/review;
- full-game ordinals, participant/period identity, result, value, and tracked/opponent side survive
  derivation;
- side, participant, period, result, and value filters overlap without changing the source;
- ended or suspended parked event games resume into explicit Basketball Summary while active games
  still resume into Tracker; and
- existing court geometry and legacy navigation contracts remain unchanged.

Run:

```bash
pnpm exec vitest run src/lib/basketball/summaryShots.test.ts src/lib/basketball/summary.test.ts src/lib/sportNavigation.test.ts src/components/shot-chart/courtGeometry.test.ts
pnpm test
pnpm lint
pnpm build
```

## BKE-4D4 Focused Runtime Check

1. Open Shot Chart from local, primary, alternate, and canonical authorities; confirm every source
   switch replaces all markers, lists, totals, filters, and open detail state rather than blending.
2. Filter tracked/opponent, participant, regulation/overtime period, made/missed, and 2PT/3PT;
   confirm the court and both lists stay in parity and free throws remain absent.
3. Select located, overlapping, and unlocated attempts by pointer and keyboard; confirm each opens
   the shared full-game ordinal/detail and focus returns to the originating control.
4. Edit/remove a shot from a healthy owned local game. Confirm remote, canonical, suspended,
   completed, and abandoned sources show detail without mutation controls.
5. Deep-link and refresh `tab=shots` from Tracker, Cloud Games, Game Info, Team, and a terminal
   parked game; confirm Back returns to the recorded origin and no remote review hydrates
   `GameContext`.
6. Repeat on phone and desktop, then open representative legacy Basketball and Soccer summaries to
   confirm their authority and shot-review paths are unchanged.
