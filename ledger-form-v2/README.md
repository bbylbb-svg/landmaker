# Ledger form changes — 2026-11-13

- Independent parcel-address search through VWorld, including parcels without building addresses. Full selected land address is stored per parcel.
- Owner OCR supports names below table headings and rejects non-name footer text. Review edits select the name for explicit application; existing owners remain intact.
- Square metres precede pyeong; numeric floor ordering; additional building metadata and API lookup types (attached lots, wastewater).
- Owner notes and property kind; four-digit date years; top save controls; deletion overlay stacking; external navigation; expanding text fields.
- Existing unsaved production drafts restore named inputs independently of changed field positions; original draft retained before upgrade restoration.

## Verification

Actual VWorld search and land-detail calls both returned HTTP 200 with matching PNU, land category and positive area. A 2600×3600 synthetic Korean ledger image was pasted through the browser clipboard, recognized by Tesseract, reviewed and applied to the owner input. No real owner documents used. Parser cases include footer rejection, names following headings, joint names and unlabeled crops.

Synthetic building responses verified floor order 1, 2, 10 and field serialization for attached lots, indoor/outdoor parking and sewage type/capacity. Staff-authenticated live building lookup returned two buildings and nine floor rows; all nine rows were applied in numeric floor order, with parking counts preserved. Related-lot and wastewater calls also completed; empty provider results remained blank. JWT and user validation are preserved. Optional lookup failures remain visible and do not clear prior input. Existing matched ledger records are retained.

Browser checks covered six-digit year correction, multiline owner-note expansion and the deletion overlay's frontmost hit target. Static syntax validation passed for both HTML builds.

No business-record migration, deletion or replacement performed. Access and OneNote sources untouched.

Building drawings are not connected through the public ledger attribute API. The form links to the official Eais issuance guide, which describes ownership/eligibility and approval requirements.
