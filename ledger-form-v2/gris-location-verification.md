# GRIS property location links

2026-11-16

Adds 위치 beside 복사 and 열기 in the standard fast property table. A single parcel with a recorded PNU opens the GRIS map URL directly. Multiple parcels show individual map links. Legacy parcels without PNU resolve through the existing authenticated land-address search, filter exact lot number and mountain flag, and show distinct municipalities instead of selecting ambiguous matches.

No workspace or source table writes. No API keys are added to map links. External links use noopener/noreferrer.

Verification: HTML scripts parse; tests cover PNU URLs, invalid PNU, exact parcel filtering, full-address municipality matching, mountain lots and ambiguous addresses. Browser synthetic-data checks confirm both location buttons, independent multi-parcel links, preserved table row action behavior and legacy municipality candidate selection.

Limit: actual GRIS rendering could not be verified in this environment (ERR_HTTP2_PROTOCOL_ERROR in the browser and HTTP 503 during direct retrieval). Official indexed map URLs expose the mapCd=01&pnu=… format. Do not claim that the destination map was visually verified.
