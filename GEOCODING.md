# Geocoding Implementation Reference

## Overview

Addresses are geocoded server-side (FastAPI backend) using two providers routed automatically:

| Provider | Coverage | Rate limit | Used for |
|---|---|---|---|
| **Geocodio** | US + Canada | None (batch-friendly) | All US/Canadian addresses |
| **Nominatim** (OpenStreetMap) | Worldwide | 1 req/sec (enforced) | International addresses + Geocodio fallback |

---

## Provider Routing

### Detection — `is_us_canada(addr)`

Checks each comma-separated part of the address against a hardcoded set of US state codes and Canadian province codes (`US_CA_CODES`). Also detects addresses ending with `, US`, `, USA`, `, United States`, or `, Canada`.

```
"500 Main St, Fairless Hills, PA, 19067"  → PA matched → Geocodio
"10 Downing St, London, UK"               → no match  → Nominatim
"29160 Acheson Road, Acheson, AB, T7X 6A8"→ AB matched → Geocodio
```

### Geocodio Batch API

All US/Canada addresses in a single request are sent as a **single POST** to `https://api.geocod.io/v1.10/geocode`. This means 50 addresses = 1 HTTP call instead of 50.

- Max 10,000 addresses per request
- Response is returned synchronously (no polling)
- Cache is checked first; only uncached addresses are sent
- API key read from `GEOCODIO_API_KEY` env var (falls back to hardcoded key in code)

Geocodio response is normalised to Nominatim format internally:
```json
[{ "lat": "40.1", "lon": "-75.2", "display_name": "500 Main St, ..." }]
```

### Nominatim (International / Fallback)

- Sequential, 1.1s delay between requests
- Used for: international addresses, and US/Canada addresses Geocodio couldn't resolve
- `User-Agent` header set to `PNGMapper/1.0 (pngmapper.netlify.app)` as required by OSM policy

---

## Fallback Chain

For each address (US/Canada):
1. **Geocodio batch** — all addresses sent together
2. If Geocodio returns 0 results for an address → **Nominatim fallback** tries:
   - `City, ST` (e.g. `Florham Park, NJ`)
   - `ZIP, ST` (e.g. `07932, NJ`)
   - Full normalized address

For international addresses:
1. Full address via Nominatim
2. If no result → same city/zip fallback strategies

---

## Address Normalization Pipeline

Every address goes through `normalize()` before geocoding:

1. Strip surrounding CSV quotes (`"1420 Hamric Rd"` → `1420 Hamric Rd`)
2. Collapse tabs/multiple spaces to `, ` (handles Excel tab-pasted data)
3. Strip `, US` / `, USA` / `, United States` / `, Canada` country suffix — applied twice to handle double suffixes like `, Canada, US"`
4. Strip any remaining trailing `"`
5. Fix 4-digit US ZIP codes missing leading zero (`NY 1234` → `NY 01234`)

---

## Frontend Address Parsing (`LocationInput.jsx`)

### Input format

Paste tab-separated data from Excel. First row must be headers. Recognised column names:

| Column | Keywords matched |
|---|---|
| Street | `street`, `address` |
| City | `city` |
| State/Province | `state`, `province` |
| ZIP/Postal | `zip`, `postal` |
| Country | `country` *(captured but not added to address — see below)* |

### Excel paste cleaning (`cleanExcelPaste`)

Runs on paste before the text is shown in the textarea:

1. **Multiline cell merge** — Excel wraps cells containing newlines (Alt+Enter) in `"..."` on paste. Lines starting with an unmatched `"` are buffered and merged with the next line using `, `.
2. **Field quote stripping** — Removes surrounding `"` from individual tab-separated fields (`"Boston"` → `Boston`).
3. **Escaped quote normalisation** — `""` → `"`.

### Why country is not included in the address string

Appending `US` to addresses breaks provider routing because `US` is not a US state code. The state/province code already uniquely identifies the country.

---

## In-memory Cache

- **Backend**: `GeocodeLRUCache` — `OrderedDict` with TTL. Max 5,000 entries, 24-hour TTL. Thread-safe.
- **Frontend**: `LRUCache` JS class — Max 500 entries, 6-hour TTL.
- Cache key: lowercased, whitespace-normalised address string.
- Cache is checked before every Geocodio batch (uncached addresses only sent) and before every Nominatim call.

### Cache stats endpoint

```
GET /health
```
Returns uptime and cache hit/miss counts:
```json
{ "status": "ok", "uptime_seconds": 3600, "geocode_cache": { "size": 42, "hits": 18, "misses": 24, "hit_rate": 0.4286 } }
```

---

## Geocodio `precision` / `accuracy_type` values

Returned as the `precision` field on each geocoded location:

| Value | Meaning |
|---|---|
| `rooftop` | Exact address match |
| `range_interpolation` | Estimated from address range on street |
| `intersection` | Nearest intersection |
| `street_center` | Middle of the street segment |
| `place` | City/town level |
| `county` | County level |
| `state` | State level |
| `nominatim_fallback` | Geocodio had no result; resolved by Nominatim |
| `city` | Nominatim city+state fallback |
| `zipcode` | Nominatim ZIP code fallback |
| `cache` | Served from in-memory cache |

---

## Known Issues & Past Fixes

### `, US` suffix routing wrong provider
**Problem:** Excel data with a Country column appended `US` to every address. `is_us_canada()` didn't recognise `US` as a code so all addresses went to Nominatim.
**Fix:** Frontend no longer appends country column. Backend `normalize()` strips country suffixes. `is_us_canada()` explicitly checks for country name endings.

### Pennsylvania address plotted in Panama
**Problem:** Address `500 Middle Drive, Fairless Hills, Pennsylvania, 19067` — the `extract_street_city` helper was extracting `PA, ` (state + empty field). Nominatim matched `PA` → Panama.
**Fix:** Rewrote address-part helpers to split on commas rather than regex on raw string.

### Nominatim 429 rate limit
**Problem:** Sending 43 addresses sequentially to Nominatim (~1 address/sec) triggered OSM's bulk geocoding ban.
**Fix:** Switched US/Canada to Geocodio batch (1 HTTP request for all addresses).

### LocationIQ invalid key (historical)
The original geocoding provider. Key `pk.4da8ea476...` was invalid. Replaced with Geocodio + Nominatim.

### Quote marks appearing in textarea
**Problem:** Excel multiline cells (Alt+Enter) paste with CSV-style `"..."` wrapping, showing raw quotes in the input.
**Fix:** `cleanExcelPaste()` runs on paste, merges multiline cells and strips field quotes before setting textarea state.

### Split multiline addresses
**Problem:** Excel cells containing two-line addresses (`1420 Hamric Rd` / `Hazen, AR 72064`) pasted as two separate rows.
**Fix:** `cleanExcelPaste()` detects lines starting with an unmatched `"` and merges them with the continuation line.

---

## Configuration

### Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `GEOCODIO_API_KEY` | Render env vars | Geocodio API key |
| `VITE_API_URL` | Netlify env vars | Backend URL for frontend |

### Deployment
- **Backend**: Render — auto-deploys on push to `main`. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Frontend**: Netlify — auto-deploys on push to `main`. Build command: `npm run build`

### Debug endpoints
```
GET /health                          — cache stats + uptime
GET /debug-geocode?q=<address>       — test geocoding a single address, shows which provider was used
```
