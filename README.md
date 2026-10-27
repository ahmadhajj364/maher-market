# Maher Market System

Shop system for Moasaset Maher Al Tijariya (مؤسسة ماهر التجارية), Lebanon. Arabic and English, USD and LBP.

Pages: Till, Products & stock (sections: shelves by aisle, spices, fridge, olives & pickles), Suppliers, Opened boxes, Debts (customers and employees), Payments, Today, Settings.

## How it runs

`index.html` is a single page served by GitHub Pages. Its data lives in Supabase (Postgres): one row per
record in the `docs` table, written only through the `set_doc`, `merge_doc` (deep merge, so tills never
overwrite each other) and `delete_doc` functions, and pushed live to every open device through Supabase
Realtime. Only logins listed in the `staff` table can read or write.

First-time setup: run `supabase/setup.sql` in the Supabase SQL Editor after creating the store login
(Authentication > Users > Add user). It is safe to run again.

## Data layout

| Collection | One document per | Notes |
| --- | --- | --- |
| `products` | product | `shelf`, `openBox`, `closed` are the counted stock; each till adds its own sales to `soldBy.<till>`, and `soldBase` marks sales already counted in |
| `sales` | till per hour (`<date>_<hour>_<till>`) | `receipts` is keyed by receipt id |
| `customers` | customer or employee (`kind`) | `entries` is keyed by entry id (debts and payments) |
| `suppliers`, `payments` | supplier, bill | |
| `settings/main` | | exchange rate, VAT, shelf warning level |

## Load test

`tests/supabase-load.js` opens several tills and a back-office device in Chromium, each running the real
supabase-js, against a local Postgres loaded with `supabase/setup.sql` behind a stand-in for Supabase's
login, REST and realtime (with network delay, oversized realtime messages, and optionally a cut live
connection). It then checks receipts, stock, debts, payments and supplier links against what was rung up,
and that every device shows the same stock.

```
npm i pg @supabase/supabase-js
PGURL=postgres://postgres:pg@localhost/maher_test node tests/supabase-load.js <sales per till> <latency ms> <tills> [drop]
```

Last run (`100 400 5 drop`): 6 devices, 1,040 products, 500 sales at 400 ms latency, live connection cut
for 6 seconds mid-run: 500 of 500 receipts, stock, debts, payments and supplier links all exact, all
devices agree. Scan about 0.2 s, a full sale about 1.6 s.
