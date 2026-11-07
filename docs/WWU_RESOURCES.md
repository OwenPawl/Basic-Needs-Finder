# WWU resource directory

The public homepage follows Owen's WWU challenge documents: food access first, anonymous browsing, no location collection, provider hours and directions, SNAP help, and a plan students can print or save. It complements WWU's Basic Needs Hub and is explicitly an independent student project. The original exchange specification remains future work.

## Sources and maintenance

All entries in `src/data/wwu-resources.json` were checked November 7, 2026 against official sources. Hayden independently compared all 11 entries and reported no incorrect hours or addresses. The Freedge source was strengthened to the operator page after his review. Each record carries its own source and checked date; update both whenever information is rechecked. The visible directory date should track a full-directory review, not a deployment date.

| Resource | Source and selection notes |
| --- | --- |
| WHOLE Pantry | [WWU WHOLE page](https://basicneeds.wwu.edu/whole-pantry). Use this specific page over conflicting older summary hours. |
| CEED, Fairhaven, Journalism pantries | [WWU additional campus resources](https://basicneeds.wwu.edu/additional-campus-food-resources). Room 150 is the CEED pantry; 150H is the coordinator office. Building access and quarter breaks affect availability. |
| Bellingham Food Bank groceries and drive-through | [Provider service page](https://www.bellinghamfoodbank.org/get-food/). Separate programs because drive-through requires a reservation. Closures are explicitly dated 2026, not a permanent holiday calendar. |
| Community Freedge | [Operator page](https://sustainableconnections.org/freedge/). Behind The RE Store at 2316 Kulshan Street. Operator details confirmed through its indexed page and Hayden's independent fetch after a direct-fetch timeout. |
| SNAP application help | [WWU food resources](https://basicneeds.wwu.edu/food-resources). Friday drop-in schedule applies during the quarter; appointments are linked through the provider. |
| Basic Food | [Washington DSHS](https://dshs.wa.gov/family-food-and-housing-services/food-assistance/basic-food-benefits), with the official [Washington Connection application](https://www.washingtonconnection.org/). DSHS determines eligibility; this app does not. |
| Emergency Food Credit | [WWU Financial Aid](https://financialaid.wwu.edu/wwu-emergency-food-credit-application). Enrollment, quarter, processing time and funding restrictions are shown; no approval promised. |
| Food and meal guide | [Whatcom Asset Building Coalition](https://www.whatcomabc.org/food-guide/). Links to a two-page August 2026 PDF plus Spanish, Russian, Ukrainian and Punjabi versions were visible when checked. Link out instead of duplicating changing meal schedules. |

Use [WWU's campus map](https://map.wwu.edu/) for buildings and [WTA's trip planner](https://schedules.ridewta.com/) for current transport. Destination-only directions links don't supply a user's location. Linked services have their own privacy practices. No map, remote image, or third-party script is embedded by this page.

This is a curated starting set, not a complete resource census. No expired event is presented as upcoming. Additional pantries, the WinCo shuttle and other programs can be added after their specific current source is checked. Listed service-day filters match weekly schedules; unscheduled programs appear under Any day. They do not calculate open-now status or holiday availability.

## Behavior and data boundaries

- Text-first WWU blue design with standard Lucide interface icons. All nine generated illustration assets and the fictional catalog component were removed.
- Search, resource type, area and service day filters combine. Empty results have a reset action.
- Native detail dialogs show access requirements, provider links, directions and source dates; Escape closes them and returns focus.
- Add/remove resources to an in-memory plan. No local/session storage, analytics, student profiles or location permission. Reload clears selection. Printing/text export only includes selected resources and source/direction links.
- No live stock, booking or application processing is claimed. Actions link directly to providers.
- Backend test seeds and `catalog.json` are internal fixtures; the public entry point imports only the WWU directory.

## Verification

TypeScript, 11 unit tests (including combined filters, Sunday handling, selected-resource exports and fixture isolation), and the Pages static build passed. Existing PostgreSQL foundation checks remain in CI. Browser checks passed for desktop plus 320/390 px layouts, combined filters, no-results recovery, adding a plan, selected-only view, detail links, Escape and focus return. The print DOM contains only selected resources with source/directions links. Native OS print completion and the browser-managed download destination were not inspectable through the in-app browser; generated export content is covered by unit tests. Deployment results are recorded in the PR and mesh. This is not an ADA certification or a live Supabase authentication test.
