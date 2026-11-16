# Integrated Excel property location and column-width verification

2026-11-16

Moves the GRIS location action from the registration fast list to the integrated 매물목록 · 엑셀형 table used by the user. The first location column stays on the left. Modern registered properties keep all parcels; Access and new-property rows are adapted from explicit land/district/lot fields. Owner address fields are never used as property location. Conflicting lot/sub-lot values do not generate an invented address. The huge-data Excel fallback also receives a location action and adjustable widths.

All integrated table columns have draggable and keyboard-accessible boundaries, clamped to 56–1200px. Widths are stored by column key in this browser's localStorage and restored after filtering, loading more fields/rows, navigation or refresh. Reset affects widths only, not filters or data. Existing filters remain separate from resize handles.

Validation:
- JavaScript syntax for both builds, width limits, mountain PNU generation, exclusion of owner address, and conflicting lots.
- Actual browser pointer drag resized 地域/지역 from 200px to 300px.
- Column filtering continued to work (one matching row) and retained the 300px width.
- Width persisted across refresh (200px test) and screen navigation (300px test).
- Synthetic Access mountain lot resolved to the exact mountain PNU; registered multiple-parcel row showed independent links for both parcels.
- Registration fast-list location action count: zero. Excel location actions: four across Access, new and registered fixtures.

No business-record writes, migrations or changes to Access/OneNote originals. GRIS destination rendering remains subject to the previously documented external connection limitation.

Owner-history discussion is a separate design proposal; no automatic ownership transfer or historical data rewrite is included here.
