# Landmaker durable offline synchronization

The HTML files embed the engine, adapter and verification source. Existing customer, property and schedule rows are not initialized or migrated.

- IndexedDB operations are append-only. A local transaction commits before transmission begins. Failed transactions never receive a saved acknowledgement.
- Each request has a UUID, authenticated staff identity and stable device ID. The server records the original request and result atomically; repeating the same ID returns the same result. Reusing it with different contents fails.
- The server locks the workspace and merges per record and field. Independent fields can merge. Ambiguous same-field updates and delete/update conflicts retain the server row and preserve the local request as a conflict.
- Same-record conflict resolution shows both values. The reviewed replacement is a new operation based on the observed server row; a newer concurrent edit causes another conflict.
- Saved journal entries and server receipts remain available after acknowledgement. Local operations are checkpointed only after the resulting server data has been cached.
- Background refresh updates the PC cache. It does not rerender or replace an open customer/property input form.
- Existing Access and OneNote source rows remain unchanged; edits are sent to their existing editable companion tables. Offline deletion from these source tables is disabled.
- New person identifiers use UUIDs to prevent independently created people from sharing a sequential code on different PCs. Existing identifiers are preserved.

## Verification

Run `node sync-engine.test.cjs`. The app's **저장 내역 → 4명 동기화 안전검증** uses four independent browser databases and an isolated server workspace. It verifies restart persistence, concurrent submissions, response loss and replay, independent-field merge, same-field conflict, retained records and ID reuse rejection. It does not create live business records.

For full-form verification, the test site supports `?lm-sync-sandbox=<uuid>`. This uses a separate local journal/cache and isolated server workspace. Combine it with `&lm-offline-test=1` to block all outgoing requests through the test service worker. Never use a business dataset as test input.

Verified on 2026-11-13: native offline customer/consultation/property registration survived reload; reconnection submitted five journal operations to the isolated workspace. Live workspace remained at version 175 with checksum `ae650ef6de521501c26e9cfaf410510b` throughout verification.

Offline data not yet transmitted is still dependent on that PC's browser storage. Clearing browser data or losing the PC before backup/transmission can lose that local-only data. This system does not promise absolute immunity to device failure.
