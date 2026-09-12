# Sara App Mockup — Customization Guide (per clinic / demo)

This is the **demo app** ("Sara") you screen-record on your phone for the doctor outreach
video. It's **one HTML file, one app** — Calls, Patients, Broadcast, and Pharmacy are
**tabs inside it** (real tab switching, no page reloads), not separate pages. It's a
**template**: one `CONFIG` block at the top drives everything — edit that block and
nothing else.

## Where the files live
```
video/
  sara-app.html               ← generic master (Dr. Sharma's Clinic placeholder)
  ferty9-jyothibudi/           ← one folder PER CLINIC, named <clinic>-<doctor>
    sara-app.html              ← that clinic's saved, demo-ready version
```

**Naming rule:** every clinic gets its **own folder named after the hospital/doctor**
(e.g. `ferty9-jyothibudi/`, `apollo-drmehta/`), containing its own `sara-app.html`. Never
overwrite another clinic's folder — that's how every version stays saved and demo-ready
for whenever you go back to pitch them again.

## The 4 tabs (and the video beat each supports)
| Tab | Shows | Voice-over beat |
|---|---|---|
| **Calls** | Sara answering & logging calls 24×7, today's stats | "…answers every call, asks their condition, saves it, books the appointment." |
| **Patients** | The owned patient list — number + condition saved | "…in your system, forever. Not Instagram's audience. Yours." |
| **Broadcast** | Reaching patients directly (treatments/offers/camps/reminders) | "…you reach them directly, on their phone." |
| **Pharmacy** | The clinic's pharmacy products + a promo composer | "…and now sell straight from your pharmacy to the patients Sara already saved." |

---

## How to make a new clinic version (≈10 min)

1. **Duplicate** the `ferty9-jyothibudi/` folder → rename it `<clinic>-<doctor>/`
   (lowercase, no spaces, e.g. `apollo-drmehta/`).
2. Open `sara-app.html` and **edit only the `CONFIG` block** at the top (fenced with
   `✏️ EDIT ONLY THIS BLOCK`). Everything below it — layout, styling, tab logic — stays
   untouched.
3. Save. Open the single file on your phone (AirDrop it, or publish as an Artifact for a
   link) and **screen-record**, tapping between tabs as you narrate each beat.

### What to research per doctor (from their Instagram / Practo)
- Clinic/hospital name and the doctor's name.
- **Specialty → the conditions** patients call about (this is what makes it believable).
- A couple of realistic **treatments/offers** for the Broadcast message.
- **Pharmacy products** relevant to their specialty (see cheat-sheet below) — this is what
  makes the "sell from your pharmacy" pitch land.

### CONFIG fields (all in one `CFG` object in `sara-app.html`)

**Calls tab**
- `clinicName` — shown under the Sara logo (used on every tab).
- `liveCall` — the masked number in the "Sara is on a call" banner.
- `totals` — `{ answered, booked, newPatients }` for today's stat tiles.
- `calls[]` — each row: `i` (initials), `c` (avatar hex colour), `name`, `num` (masked),
  `tag` (the condition), `out` (`{ t: label, k: book|new|callback|info }`), `time`.

**Patients tab**
- `ownedCount` (e.g. `"2,140"`), `addedToday`.
- `patients[]` — `i`, `c`, `name`, `num`, `tag` (condition), `st` (`{ t, k: book|new|callback }`),
  `when`, optional `saved:true` (green dot).

**Broadcast tab**
- `templates[]` — the 4 message-type chips; `selectedTemplate` — index highlighted.
- `message` — the composed message (HTML `<b>…</b>` allowed for emphasis).
- `audience`, `audienceCount` — who it's going to.
- `campaigns[]` — past broadcasts: `e` (emoji), `title`, `ago`, `sent`, `delivered`, `booked`.

**Pharmacy tab** (products the clinic's pharmacy can promo/sell)
- `pharmacyTotals` — `{ orders, revenue }` for this month's stat tiles.
- `products[]` — `i` (emoji icon), `name`, `price`, `tag` (category), `stock`
  (`"In stock"` / `"Low stock"`), `promo` (`true` shows a PROMO pill).
- `promoTemplate` — the promo message shown in the composer (HTML `<b>…</b>` allowed).
- `promoAudience`, `promoAudienceCount` — who the promo targets.

### Condition cheat-sheet by specialty (fill `tag` / conditions)
- **Fertility / IVF (e.g. Ferty9):** IVF consult, IUI follow-up, PCOS, fertility check-up,
  pregnancy scan, egg freezing.
- **Dermatology:** acne, hair loss, pigmentation, laser, skin allergy.
- **Dental:** root canal, braces, cleaning, implant, whitening.
- **Orthopaedics:** knee pain, back pain, sports injury, physiotherapy.
- **Paediatrics:** child fever, vaccination, growth check, cough & cold.

### Pharmacy product cheat-sheet by specialty (fill `products[]`)
- **Fertility / IVF:** prenatal multivitamins, folic acid, progesterone support, CoQ10
  supplement, ovulation test kits.
- **Dermatology:** sunscreen, face wash, hair growth serum, vitamin D3, moisturizers.
- **Dental:** electric toothbrush, fluoride mouthwash, whitening kits, floss.
- **Orthopaedics:** joint support supplements, pain-relief gels, posture braces.
- **Paediatrics:** vitamin syrups, ORS sachets, fever thermometers, probiotics.

---

## Recording tips (mobile)
- Open the single file on your phone (same-Wi-Fi link, AirDrop, or the Artifact URL).
- Screen-record; tap between tabs slowly and let each screen's animation finish before
  narrating — the entrance animation replays every time you open a tab.
- Scroll slowly within a tab so numbers/conditions are readable.
- Keep the shared **bottom tab bar** visible — it sells "this is a real, live app," and
  tapping across tabs on camera reads much better than four separate clips.

## Notes
- Brand colours (teal + coral, violet for Pharmacy) are **fixed** — Sara is one product,
  so every clinic sees the same Sara branding; only their name and data change.
- Numbers are masked (`+91 98••• ••210`) — keep them masked for privacy in demos.
- Data is illustrative; it's a mockup for the pitch, not a live system.
