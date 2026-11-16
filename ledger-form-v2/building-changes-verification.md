# Building change-note and violation checkbox verification

2026-11-16. Adds a change-notes textarea below each building's floor information in the existing property registration/edit form. Notes and automatic/manual checkbox mode are serialized per building; read-only property details also show the notes and violation label.

Automatic interpretation is based solely on entered/pasted text, not an official API status. Explicit latest violation markers may check the flag. Only a flag previously set automatically is cleared by an explicit latest clearance/absence marker. Existing manual flags are preserved. Directly changing the violation checkbox disables automatic mode. Unknown/ambiguous text never clears the flag. Dated records use the latest date; mixed undated histories and conflicting latest records request manual review. Applications, planned clearance and requests are not treated as completed clearance.

Validation:
- 16 classification cases including active markers, clearance, denied/pending clearance, historical/uncertain text, newest dates in either order, mixed undated histories and same-date conflicts.
- Browser input checked the actual violation checkbox; newest clearance unchecked an auto-owned flag.
- Manual flag changes disabled automatic mode and survived subsequent note edits.
- Two buildings retained independent notes and flag states.
- Serialized output retained changeNotes, violation, violationAuto and violationAutoSet, including a building with only notes.
- All inline JavaScript compiled in production and test HTML.

No database migration, business-record writes or edits to Access/OneNote originals. No changes to the GRIS location feature.
