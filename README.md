# Maher Market System

Shop system for Moasaset Maher Al Tijariya (مؤسسة ماهر التجارية), Lebanon. Arabic and English, USD and LBP.

Pages: Till, Products & stock (sections: shelves by aisle, spices, fridge, olives & pickles), Suppliers, Opened boxes, Debts (customers and employees), Payments, Today, Settings.

## How it runs today

`index.html` is published as a claude.ai Artifact and keeps its data in that Artifact's database
(`window.claude.use("db")`). Opened on its own, outside claude.ai, the page loads but cannot save.
Moving the data to a hosted database (Supabase) is the next step before serving it from GitHub Pages.

## Data layout

| Collection | One document per | Notes |
| --- | --- | --- |
| `products` | product | `shelf`, `openBox`, `closed` are the counted stock; each till adds its own sales to `soldBy.<till>`, and `soldBase` marks sales already counted in |
| `sales` | till per hour (`<date>_<hour>_<till>`) | `receipts` is keyed by receipt id |
| `customers` | customer or employee (`kind`) | `entries` is keyed by entry id (debts and payments) |
| `suppliers`, `payments` | supplier, bill | |
| `settings/main` | | exchange rate, VAT, shelf warning level |

## Load tests

`tests/stress.js` (2 tills) and `tests/heavy.js` (many tills plus a back-office device) drive the page in
Chromium with Playwright against a shared mock database with network delay, then check receipts, stock,
debts, payments and supplier links against what was rung up.

```
node tests/heavy.js "$PWD/index.html" <sales per till> <latency ms> <tills>
```

The last run: 6 devices, 1,040 products, 500 sales at 400 ms latency, with every total matching.
