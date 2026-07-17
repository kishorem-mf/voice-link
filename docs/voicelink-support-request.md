# VoiceLink Support Request — ElevenLabs Outbound Not Connecting

**Account:** Nanda Kishore (kishorem.mf@gmail.com) — Reseller/Client, Trial Pack
**Trunk:** `ELEVENLABS-IN.nanda kishore`
**DID:** +919429391391

---

## Ready-to-send message (CURRENT ISSUE — SIP 603 Declined)

> **Subject: Outbound calls returning SIP 603 Declined on all numbers — trunk ELEVENLABS-IN (DID +919429391391)**
>
> Hi VoiceLink support,
>
> Outbound calls through my SIP trunk `ELEVENLABS-IN.nanda kishore` (DID **+919429391391**) have started **failing with SIP 603 Declined on every destination number**, and I'd like help identifying why.
>
> **Account:** Nanda Kishore (kishorem.mf@gmail.com) — Reseller/Client, Trial Pack.
> **Integration:** ElevenLabs Conversational AI → my trunk. Outbound address `160.30.71.89:3300`, Transport TCP. Dialing plain E.164 (e.g. +917842160862).
>
> **What's happening**
> - A call on **12 Jul 2026 at 08:53 IST connected successfully** (66-second conversation).
> - Since this afternoon, **all outbound calls return SIP 603 Declined** before ringing — same behaviour on two different destination numbers.
> - **Account balance is sufficient** (already checked). No call is in progress (single channel is free). Nothing changed in my configuration since the successful morning call.
>
> **Reference call IDs (all SIP 603):** `conv_9401kxb6755mfhwsewwxx7vat9n4`, `conv_4701kxb6c19xffxas39z0p9f27jf`, `conv_2101kxd4m1nrf8c8wsn4yc6wtvgw`.
>
> **My questions**
> 1. Is the DID **+919429391391 flagged, throttled, or blocked** for outbound (e.g. spam/anti-fraud after several calls today)? If so, how do I clear it and what's the daily limit?
> 2. Is there a **Trial-Pack daily call/attempt cap** independent of balance?
> 3. This DID is a standard mobile number, **not on a DLT 140/160 series** — is that causing the operator to decline/throttle outbound telemarketing-pattern calls? Do I need a **DLT-registered 140-series DID** to place these calls reliably?
> 4. Is there any **time-of-day or day-of-week (e.g. Sunday) restriction** applied to this trunk?
> 5. What are the exact steps to get a **compliant outbound-capable DID + adequate channels/CPS** for production volume?
>
> Thanks for your help.

---

## Earlier message (setup-phase — IP whitelisting / dial format)

> **Subject: Outbound calls via ELEVENLABS-IN trunk failing — need IP whitelisting / dial-format confirmation**
>
> Hi VoiceLink support,
>
> I'm integrating ElevenLabs Conversational AI with my SIP trunk `ELEVENLABS-IN.nanda kishore` (DID +919429391391) for outbound calls, following your ElevenLabs integration guide. Signaling reaches your server but calls don't complete. Details:
>
> **My config**
> - Outbound address: `160.30.71.89:3300`, Transport: **TCP**, Media encryption: disabled
> - Tech prefix: `45454`
> - ElevenLabs account: **standard/global** (outbound calls originate from ElevenLabs' dynamic **US** IP addresses)
>
> **What I'm seeing (test target +917842160862)**
> | Number sent to trunk | Result |
> |---|---|
> | `+917842160862` (plain E.164) | SIP **404 Not Found** — but the phone *rang* and dropped on answer |
> | `45454917842160862` (prefix + 91 + national) | SIP **404 Not Found** |
> | `4545407842160862` (prefix + 0 + national) | **Accepted** (call went "in-progress") but the phone **never rang**, 0s duration |
>
> **My questions**
> 1. **IP whitelisting:** My outbound calls come from ElevenLabs' dynamic US IPs. Your docs say you require a static IP to whitelist. Can you whitelist ElevenLabs' outbound IP ranges on your side so a **global** (non-India-residency) ElevenLabs account can place calls? If so, what source IPs/ranges do you need from me, and where do I submit them?
> 2. **India residency:** Your docs recommend an ElevenLabs **India-residency** account (in.residency.elevenlabs.io) since Indian IPs are pre-allowed — but that portal **won't load** for me. Is there an alternative, or can you help me get access/provisioned?
> 3. **Exact dial format:** What is the exact destination-number format the `ELEVENLABS-IN` trunk expects? I get 404 even with `45454` + `91` + national (matching your doc example). Only `45454` + `0` + national is accepted, but that call never reaches the phone.
> 4. **Tech prefix handling:** Should `45454` be embedded in the dialed number, or is it auto-applied on your side based on my account/source IP?
> 5. **Call routing:** Please confirm the DID +919429391391 → `ELEVENLABS-IN` trunk routing is active for outbound.
>
> Thanks!

---

## Internal notes (context, not for the message)

- Root-cause: our ElevenLabs account is **global/standard**, so outbound SIP originates from **dynamic US IPs** VoiceLink hasn't whitelisted → 404. VoiceLink's docs recommend an India-residency ElevenLabs account (Indian IPs pre-allowed, static SIP IPs).
- **Confirmed via ElevenLabs docs:** India data residency is **Enterprise-only** and a *separate* isolated account with its own API URL + key. Not self-serve — that's why the in.residency portal won't load and our standard key gets 401 there. Requires contacting `sales@elevenlabs.io` / `success@elevenlabs.io`.
  - India API base URL (confirmed correct): `https://api.in.residency.elevenlabs.io/v1`
  - India SIP static endpoint: `sip-static.rtc.in.residency.elevenlabs.io`
- ElevenLabs static whitelistable outbound IPs are also **Enterprise-only**. So both viable paths ultimately require an ElevenLabs Enterprise arrangement.
- The harness code is ready: `ELEVENLABS_BASE_URL` and `TECH_PREFIX` are configurable, so once we have working credentials/whitelisting it's a `.env` change + re-run `agent:create` → `provision` → `dial`.
- Diagnostic conversation IDs (global endpoint): `conv_1101kx9d7zh8edr9szn2dc1h0v2s` (404), `conv_6301kx9dg36jfwrs1xm8nqt2x98d` (accepted, no ring).
- Sources: ElevenLabs Data residency docs; "Introducing India Data Residency for Enterprises" blog.
