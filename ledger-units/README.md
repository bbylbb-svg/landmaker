# Unit ledger integration

The property editor includes a separate unit section. Existing whole-building fields, floor rows, customer data and schedules are not modified by unit lookup/import. A selected unit's address is added as a parcel when absent, without guessing land area. Shared address selection also primes the unit lookup.

- `units` requests the official `getBrExposInfo` endpoint through the existing authenticated Edge Function. `area` keeps using `getBrExposPubuseAreaInfo`.
- Both requests follow all pages; repeated or incomplete pages produce a failure rather than silently truncating a list.
- Unit identity includes district codes, lot type, main/sub lot, building designation and room designation. The same provider identifier does not merge different buildings/lots.
- Area rows join by building and room. A missing building designation may match only if the room is unique. Code 1 is exclusive; code 2 is common. Unknown values are never treated as zero. Shared area and exclusive area remain separate; neither is labeled sales area.
- Selected units live in `unitRoomsDraft` until the normal property save maps them into `property.unitRooms`. Re-import preserves lease terms and owners. The existing draft restore and details view include units.
- `units.js` is also embedded verbatim into both HTML entry points to keep offline cached shells self-contained. Update both embeddings when changing it.

Validation uses mock upstream responses, not a staff login: 105-unit pagination, selected import, cross-building/cross-lot identity, unknown area, repeated import, draft/save round trip, transaction retention and no business writes. Existing land/building regression tests pass. Backend routing/auth tests cover the added units route and existing area/floor routes. A live authenticated query for a particular industrial center must still be verified in a staff session.

Run with Node 24 and jsdom 26.1.0 available:

```
node tests/unit-function.test.cjs
node tests/unit-ledger.test.cjs
node tests/address-ledger.test.cjs
node tests/address-ledger.test.cjs offline-test/index.html
```
