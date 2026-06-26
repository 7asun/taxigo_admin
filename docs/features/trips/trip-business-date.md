# Trip Business Date

- `getNextBusinessDayYmd(ymd)` — Returns the next business day YMD string. Friday returns Monday (+3), Saturday returns Monday (+2), all other days return the next calendar day (+1). Used by `useTimelessRuleTrips` to drive the look-ahead fetch window.
