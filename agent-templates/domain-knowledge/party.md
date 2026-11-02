# Party Planning Dashboard — Domain Knowledge

## What This Template Is
A multi-tab event and party planning dashboard (`waymark-party`). A complete Party Planning spreadsheet organizes event overview details alongside dedicated tabs for Guests/RSVPs, Menu, Budget, Thank You Notes, Decorations, Links, and Layout.

## Multi-Tab Structure & Column Roles
1. **`Details` tab** (primary overview):
   - Headers: `Party`, `Guest of Honor`, `Date`, `Theme`, `Venue`, `Host`
   - Roles: `party`, `guestOfHonor`, `date`, `theme`, `venue`, `host`
2. **`Guests` tab**:
   - Headers: `Guest`, `RSVP`, `Party Size`, `Notes`
   - Valid `RSVP` values: `Attending`, `Tentative`, `Declined`, `Invited`, `Pending`
3. **`Menu` tab**:
   - Headers: `Dish`, `Course`, `Assigned To`, `Status`, `Notes`
   - Courses: `Appetizer`, `Main`, `Side`, `Dessert`, `Drink`
   - Statuses: `Idea`, `Planned`, `Confirmed`, `Prepared`
4. **`Budget` tab**:
   - Headers: `Item`, `Category`, `Estimated`, `Actual`, `Paid` (`Yes` / `No`)
5. **`Thank You Notes` tab**:
   - Headers: `Guest Name`, `Gift Description`, `Date Received`, `Note Status` (`Pending` / `Sent`), `Sent Date`
6. **`Decorations` tab**:
   - Headers: `Decoration`, `Location`, `Bought` (`Yes` / `No`), `Hung` (`Yes` / `No`), `Notes`
7. **`Links` tab**:
   - Headers: `Label`, `URL`, `Type` (`Registry`, `Pinterest`, `Playlist`, `Venue`, `Other`)
8. **`Layout` tab**:
   - Headers: `Setting`, `Value` (e.g. `order` → `guests,menu,budget,thankyou,decorations,links`)

## Smart Operations
- When creating a new `party` sheet via `waymark_create_sheet({ templateKey: "party", title, seedRows })`, `Details` is populated with `seedRows` and all companion tabs (`Guests`, `Menu`, `Budget`, `Thank You Notes`, `Decorations`, `Links`, `Layout`) are automatically created.
- To read or add rows to a specific tab (such as `Guests` or `Menu`), pass `sheetTitle: "Guests"` or `sheetTitle: "Menu"` to `waymark_get_sheet` or use `sheets_values_append` on that tab.
