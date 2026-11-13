# Parcel lookup append verification

2026-11-13. No business records or source tables changed.

- Existing manual parcel 99 with area 111㎡ and custom land category remained unchanged.
- Lookup of parcel 1 appended row 2; lookup of parcel 2 appended row 3.
- Manually changed parcel 1 area to 222㎡. A repeat lookup did not append a row and retained 222㎡.
- Serialization retained three parcels in order 99, 1, 2, including their PNU identities and full addresses.
- Identity tests cover different PNU, zero-padded lot numbers, mountain flag, different municipalities and address abbreviation.
- Duplicate records may receive values only in empty fields; nonempty fields are never overwritten. Initial/trailing completely blank rows are reused.
- Manual address changes clear provider identity to avoid deduplication against a stale PNU.
- Browser tests used synthetic API responses in the existing isolated form harness.
