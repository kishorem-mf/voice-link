# VoiceLink Support — inbound drops at 32s: the ACK is missing its Route set

**Account:** Nanda Kishore (<account email>) — client `kishorehotmail`
**Trunk:** `RETELL.nanda kishore` · **DID:** +919429490490 (and previously …0345)
**Their switch:** `Asterisk PBX 18.21.0-vici` behind a Kamailio-style proxy

**Diagnosed from the packet capture. This is a SIP routing fault on VoiceLink's
side, confirmed in their own engineer's test call.**

---

## Ready-to-send reply to Jeet

> Hi Jeet — I pulled the packet capture for **your own test call**
> (`call_fc6f96d5c1a08db4d6a1378f419`, from 85XXXXXX81 at 13:23). It shows
> exactly what is happening, and it is in the SIP signalling, not the bot.
>
> **The ACK to our 200 OK never reaches the server that sent it.**
>
> Here is the ladder from the capture:
>
> ```
> 0.000s  You  → Us    INVITE sip:919429490490@18.98.16.122:5060
> 0.182s  Us   → You   200 OK   (Contact: <sip:retell@172.31.40.58:5060;transport=tcp>)
> 0.462s  You  → Us    ACK sip:retell@172.31.40.58:5060;transport=tcp   ← no Route header
> 0.683s  Us   → You   200 OK   (retransmit — we never saw the ACK)
> 4.684s  Us   → You   200 OK   (retransmit)
> 8.685s  Us   → You   200 OK   (retransmit)
>   …      every 4 seconds …
> 28.687s Us   → You   200 OK   (final retransmit)
> ~32.2s                        Timer H expires → dialog torn down
> ```
>
> **The cause.** Our 200 OK carries three `Record-Route` headers:
>
> ```
> Record-Route: <sip:18.98.16.122:5060;transport=tcp;r2=on;lr>
> Record-Route: <sip:18.98.16.122;r2=on;lr>
> Record-Route: <sip:10.0.25.168:34222;lr;did=ad1.bb32b113>
> ```
>
> Under RFC 3261 §12.1.2 and §16.6, your side must build a route set from those
> headers and send the ACK with the corresponding **`Route:` headers**. Your
> ACK has **no Route header at all** — here it is verbatim from the capture:
>
> ```
> ACK sip:retell@172.31.40.58:5060;transport=tcp SIP/2.0
> Via: SIP/2.0/UDP 10.0.25.168:34222;branch=z9hG4bK8a.ab9a44a7.2
> Via: SIP/2.0/UDP 10.0.25.44:3300;branch=z9hG4bK8a.98d68c16.2
> Max-Forwards: 68
> From: <sip:85XXXXXX81@10.0.25.118:34222>;tag=as292f11d2
> To: <sip:919429490490@10.0.25.44:3300>;tag=66c59ebf-dec8-474c-8b34-df11eacdb3a1
> Contact: <sip:85XXXXXX81@160.30.71.108:3300;did=ad1.70e4fe1>
> Call-ID: 586b249958f7d1450c273d404509bc00@10.0.25.118:34222
> CSeq: 102 ACK
> User-Agent: Asterisk PBX 18.21.0-vici
> Content-Length: 0
> ```
>
> With no route set, the only forwarding instruction left is the Request-URI —
> `172.31.40.58`, which is our **internal** address and not routable from
> outside. So the ACK stops at our edge and never reaches the media server that
> sent the 200 OK. That server keeps retransmitting, Timer H (64 × T1 = 32s)
> expires, and the dialog is torn down. **Hence exactly 32.5 seconds, every
> call.**
>
> **Why audio is perfect right up to the cut.** Media is negotiated separately
> — our SDP points at `3.42.144.134:50708` — so RTP flows normally the whole
> time and the call sounds fine until the signalling layer gives up. This is
> why it looks like "the bot stopped": the bot was mid-sentence ("Got it,
> November 29th. Could you ▌") when the dialog was torn down underneath it.
>
> **Why outbound is unaffected.** On outbound we send the INVITE and the ACK
> ourselves, so your route set is never involved. Our outbound call on this
> same trunk ran 55.7 seconds with no problem.
>
> **A second, smaller deviation.** Your ACK rewrites the To-header URI from
> `<sip:919429490490@18.98.16.122:5060>` (what we sent in the 200 OK) to
> `<sip:919429490490@10.0.25.44:3300>`. The tag is preserved so dialog matching
> still works, but per §12.2.1.1 the To header should be copied unchanged.
>
> **The likely cause, and the fix.** Your switch is `Asterisk PBX
> 18.21.0-vici`, which uses the legacy `chan_sip` driver. `chan_sip` has a
> long-standing documented behaviour: when `nat=force_rport` is active (the
> default on many builds), it routes in-dialog requests to the address the
> response came from and **ignores Record-Route entirely**, building the ACK
> with the Contact as Request-URI and no Route headers. That is precisely what
> the capture shows. See Asterisk issue **ASTERISK-21465**, which was closed as
> a configuration matter with exactly this workaround.
>
> **Please try, on this trunk's peer in `sip.conf`:**
>
> ```
> nat=no
> ```
>
> (or `auto_force_rport` on Asterisk 11+). The reporter in ASTERISK-21465
> confirmed this restored correct ACK routing. If this trunk can be moved to
> `chan_pjsip` instead, that is the proper long-term fix — `chan_pjsip` honours
> Record-Route correctly, and `chan_sip` has been unsupported for years.
>
> Two capture files are attached — your test call and one of mine. Both show
> the identical pattern.

---

## Internal notes (not for the ticket)

**How this was found:** every Retell call record carries a `pcap_url` field
(alongside `public_log_url` and `recording_url`). It is not in the dashboard UI
flow but it is in the `GET /v2/get-call/{id}` response, and it is a real
SIP capture from Retell's edge. That is the whole diagnosis — no dependency on
VoiceLink's cooperation.

```bash
curl -s -H "Authorization: Bearer $RETELL_API_KEY" \
  "$RETELL_BASE_URL/v2/get-call/<call_id>" | jq -r .pcap_url
```

Parser lives in the scratchpad (`parse_pcap.py`) — plain Python, no tshark
needed, since SIP is text over UDP/TCP.

**The evidence, ranked:**

1. **The ACK has no Route header.** Load-bearing fact. Verified verbatim on two
   separate calls (Jeet's and ours), identical in both.
2. **Nine 200 OK retransmissions** at T1-doubling-to-T2 intervals (0.18, 0.68,
   4.68, 8.69 … 28.69s) — textbook unacknowledged 2xx.
3. **Zero ACKs on the internal TCP leg.** The edge receives ACKs over UDP and
   forwards none of them inward.
4. **Timer H arithmetic.** 64 × T1 = 32s from the 200 OK at 0.182s → ~32.2s;
   observed call durations 32.501–32.506s across six calls.
5. **Media on a different IP** (`3.42.144.134`) from signalling
   (`18.98.16.122`), which is why audio survives until the teardown.

**Previously ruled out:** `end_call_after_silence_ms` (raised 30s → 120s, next
call still 32.506s); `max_call_duration_ms` (300000); the specific DID (new DID
behaves identically); agent/LLM config (failing and working agents are
byte-identical apart from `llm_id`); IP whitelisting (wrong trail from the
first draft — do not raise it).

**Retell's share of the blame, for fairness:** advertising an RFC1918 `Contact`
(`172.31.40.58`) is fragile. Record-Route exists precisely so that this works,
and a compliant UAC would route the ACK correctly regardless — so the fault is
VoiceLink's. But if Jeet pushes back, Retell putting a private address in
Contact is the one thing he can legitimately point at. A known Retell community
thread reports the same private-Contact behaviour, and separately that their
gateway rejects **all** mid-dialog re-INVITEs — worth knowing if session timers
come up later.

**Evidence files:** `docs/evidence/*.pcap` — attach these to the ticket.

---

## The two available fixes (research, 3 Nov 2026)

There are **two independent parties** who can fix this. Lead with the first;
keep the second in reserve if VoiceLink stalls.

### Fix A — VoiceLink's Asterisk (cheapest, most likely)

Their switch is `Asterisk PBX 18.21.0-vici` (VICIdial), which runs the legacy
`chan_sip` driver. Two documented `chan_sip` behaviours match our capture
exactly:

- **`nat=force_rport` makes chan_sip ignore Record-Route.** It routes in-dialog
  requests to the source address of the response and omits the Route set.
  [ASTERISK-21465](https://issues-archive.asterisk.org/ASTERISK-21465) was
  closed as *configuration, not a code bug*, with the workaround `nat=no`
  (or `auto_force_rport` on Asterisk 11+). The reporter confirmed it fixed ACK
  routing.
- **chan_sip routes ACK/BYE by Contact, not Record-Route.** Independently
  reported on the [Asterisk community forum](https://community.asterisk.org/t/ack-and-bye-to-wrong-target/95974),
  where the recommendation was to migrate to `chan_pjsip` — "chan_sip is,
  effectively, no longer supported."

**Ask:** set `nat=no` on the Retell trunk peer, or move the trunk to
`chan_pjsip`.

### Fix B — Retell's private Contact header

Retell advertises `Contact: <sip:retell@172.31.40.58:5060;transport=tcp>` — an
RFC1918 address. If they advertised the public `18.98.16.122` instead, even a
Contact-routing stack would send the ACK somewhere routable.

This is not a fringe complaint. **Twilio treats a private-IP Contact as a
provider-side defect** and documents the identical failure: *"As Twilio is
required to send the ACK back to the IP Address in the Contact header, the ACK
is being sent out to that Private IP Address"*
([Twilio SIP trunking troubleshooting](https://www.twilio.com/docs/sip-trunking/troubleshooting)).
A Retell community thread independently reports the same `172.31.x.x` Contact.

**Ask:** Retell support — advertise a publicly routable Contact for BYOC
inbound, or confirm the expected ACK routing for a trunk behind their edge.

### Honest attribution

Both sides are partly wrong, and it is worth knowing this before the argument
starts:

| | Position |
|---|---|
| **Against VoiceLink** | Record-Route exists precisely so a private Contact is harmless. A compliant UAC builds the route set and the ACK arrives. Theirs does not. |
| **Against Retell** | Publishing an unroutable Contact is fragile and breaks real-world stacks — Twilio calls it a defect outright. |

Strict RFC 3261 reading favours us, so lead with Fix A. But do not claim
VoiceLink is *solely* at fault — if Jeet knows his SIP, he will point at the
172.31 address and he will have a reasonable argument.
