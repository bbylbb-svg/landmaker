# Fixed sale ledger layouts

`sale-clean.json` is the newer default layout, authored with Artifact Tool after
the user requested a cleaner redesign. It separates brokerage title and phone,
uses four summary cards, wider land-use/building-use columns, nine detail rows,
equipment/deposit/rent/date, memo and photo area. Its print area is A1:L37;
M1:P1 are hidden calculation helpers. The same layout drives preview, print and
Excel export. `sale-clean-preview.png` shows fictional example data only.
The original supplied layout remains available under the layout selector.

`sale-fixed.json` contains the four first-page sale layouts from the user's
`A.매매-신규.xlsx`: factory/warehouse, land, home, and shop/knowledge-industry center.
The template was imported and normalized using Artifact Tool. The JSON records
the original A1:J33 worksheet XML, styles, column widths, row heights and merges
for use in both browser preview and editable OOXML export.

Example values, embedded source photos, unused shared strings, notes outside the
print area and repeated legacy forms below row 33 are excluded. The brokerage
header is provided at runtime. There are no customer/property records or storage
credentials in this asset. Changes to a ledger affect its download only; they do
not modify the property record.

The exporter keeps nine parcel/floor rows per page and creates continuation
worksheets without dropping records. Total area formulas sum all pages. Sale
area for units uses exclusive plus common area only when both are known. Missing
values remain blank; totals stay blank until every contributing area is known.
The supplied format's conversion is 3.3058 square meters
per pyeong. XLSX amounts are in ten-thousand KRW.

Sale preview/print/export use the fixed layout. Lease print retains its existing
layout; this change does not claim to supply fixed lease Excel export.
