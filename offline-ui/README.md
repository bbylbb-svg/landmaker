# Shared online and offline views

The same property/customer table builders and original detail editors run in both modes. Offline mode changes the data provider only; the separate offline list overlay is removed.

`offline-query.js` implements local filtering, stable ordering, pagination, Access JSON searches and OneNote text/phone searches. Query results are copies; source rows remain unchanged. The local adapter overlays saved per-record operations and retains the existing durable synchronization journal.

`offline-ui.js` activates cached sources without changing form layouts. Bottom-right sync, recovery, save-status and test utility controls are hidden from initial paint. Their actions are available from the navigation menu **저장·동기화 관리**. Save failures remain visible as inline status messages.

Validation: `node offline-query.test.cjs`. Browser checks used the service worker's outgoing-request block: 49,554 property rows loaded in the standard spreadsheet, address search returned two matching rows, the original 40-field property editor opened, customer headers matched online, and Access and OneNote search/detail forms worked. The three floating controls were not visible.

No source database rows are rewritten by this UI change. Existing source protection, operation receipts and conflict handling remain in place.
