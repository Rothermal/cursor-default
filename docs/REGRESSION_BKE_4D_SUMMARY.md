# Regression: BKE-4D Basketball Summary Authority

Status: BKE-4D1 and BKE-4D2 are implemented. No migration is required. BKE-4D3 and BKE-4D4 remain planned,
and Basketball event-game creation remains internal through BKE-4E.

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
