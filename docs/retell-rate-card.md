# Retell Rate Card (reference for cost evaluation)

**Source:** Retell billing → "View all rates" (167 rates), captured from the
account's live rate card. Billing period shown: **01-AUG → 01-SEP-2026**.

## How to read this
- **"per 60 units" = per minute** (1 unit = 1 second). E.g. `$0.045 per 60 units` = **$0.045/min**.
- **"per unit"** = per item (per token/message/call as noted).
- FX for INR estimates: **₹85 / $1** (adjust as needed).
- **BYOC note:** we route via our **VoiceLink SIP trunk**, so **Retell telephony = $0** for us. The telephony lines below apply only if Retell provides the number (US/Twilio/Telnyx etc.).

## A per-minute call cost = Voice Engine + LLM + Voice(TTS) + [telephony if not BYOC] + add-ons
- Retell Voice Engine: **$0.055/min** (always)
- \+ chosen **LLM** (per-min line)
- \+ chosen **Voice/TTS** (per-min line)
- \+ telephony (**$0** for us via VoiceLink)

---

## Voice / TTS (the cost driver for voice choice)
| Model line | $/min | Notes |
|---|---|---|
| elevenlabs_tts_new | 0.015 | cheapest ElevenLabs (new) |
| openai_tts_new | 0.015 | cheapest OpenAI (new) |
| cartesia_tts_new | 0.015 | |
| minimax_tts_new | 0.015 | |
| fish_audio_tts | 0.015 | |
| platform_tts | 0.015 | Retell native, cheapest |
| elevenlabs_tts_03_2026 | 0.04 | |
| elevenlabs_multilingual_v2_tts | 0.06 | **used for Hindi/Hinglish 11labs voices** |
| cartesia_tts | 0.07 | |
| minimax_tts | 0.07 | |
| elevenlabs_tts | 0.07 | |
| **openai_tts** | **0.08** | pricier than ElevenLabs standard |
| **elevenlabs_v3_tts** | **0.20** | **highest** |

**Our voices:** `11labs-Monika/Samad/Amritanshu` → ElevenLabs multilingual v2 ≈ **$0.06/min**;
`openai-Monika` → openai_tts ≈ **$0.08/min** (the costliest of our 4 Indian voices).

---

## LLM (per minute) — common picks
| Model | $/min |
|---|---|
| gpt_4_1_nano | 0.004 |
| gemini_2_0_flash_lite / gpt_5_nano | 0.003 |
| gpt_4o_mini | 0.006 |
| gemini_2_0_flash | 0.006 |
| claude_3_haiku | 0.012 |
| gpt_5_mini / gpt_5_nano tiers | 0.012 |
| gpt_4_1_mini | 0.016 |
| gpt_35_turbo / claude_3_5_haiku | 0.02 |
| claude_4_5_haiku | 0.025 |
| gemini_3_0_flash | 0.027 |
| gemini_2_5_flash | 0.035 |
| gpt_5 / gpt_5_1 | 0.04 |
| **gpt_4_1 (our default)** | **0.045** |
| gpt_4o | 0.05 |
| gpt_5_2 | 0.056 |
| claude_3_5/3_7_sonnet | 0.06 |
| gpt_4_1_high_priority | 0.0675 |
| claude_4_x/5_sonnet, gpt_5_4, gpt_5_6_terra | 0.08 |
| gemini_3_5_flash | 0.081 |
| gpt_5_5 | 0.16 |
*(High-priority variants roughly 1.5×; realtime models far higher — see below.)*

## Realtime LLM (per minute) — expensive, avoid unless needed
gpt_realtime_new $0.345 · gpt_4o_realtime_new $0.445 · gpt_realtime_2/2_1 $0.38 ·
gpt_4o_mini_realtime_new / gpt_realtime_mini_new $0.07

---

## Telephony (per minute) — **$0 for us (BYOC via VoiceLink)**
Applies only if Retell provides the number.
| Country/carrier | $/min |
|---|---|
| us_twilio | 0.015 |
| canada_twilio / canada_telnyx / us_telnyx | 0.03 |
| mexico_twilio | 0.05 |
| us_tollfree / france / italy | 0.06 |
| uk / germany / spain / australia (twilio) | 0.10 |
| **india_twilio** | **0.15** |
| malaysia_twilio | 0.20 |
| **india_telnyx** | **0.25** |
| japan_twilio | 0.28 |
| indonesia_twilio | 0.40 |
| thailand_twilio | 0.45 |
| philippines_twilio | 0.80 |

*(For US customers later, us_twilio $0.015/min is the cheapest US option.)*

---

## Add-ons & surcharges
| Item | Rate |
|---|---|
| guardrail | $0.005/min |
| background_voice_cancellation | $0.005/min |
| knowledge_base_usage | $0.005/min |
| colloquial_mode | $0.005/min |
| pii_scrubbing | $0.01/min |
| stable_server | $0.02/min |
| quality_assurance | $0.10/min (first 100 min free) |
| short_call_surcharge | $0.001/unit |
| llm_token_surcharge | $0.001/unit |
| concurrency_burst_surcharge | $0.10/min |
| branded_outbound_call | $0.10/call |
| batch_call | $0.005/call |
| sms_message | $0.01/msg |
| merge_contact_field | $0.005/unit |
| conductor_overage_message | $0.20/unit |

## Monthly subscription items (billed if quantity > 0)
| Item | $/month |
|---|---|
| us_twilio / us_telnyx / canada_twilio phone number | 2.00 |
| us_twilio_tollfree_phone_number | 5.00 |
| verified_phone_number | 10.00 |
| sms_subscription | 20.00 |
| cps_twilio / cps_telnyx | 25.00 |
| concurrency (per extra concurrent call, 20 free) | 8.00 |
| knowledge_base_hosting (Tier 1) | 0.00 |

*(Text-LLM and Post-Call-Analysis LLM charges are billed "per unit" (per token-batch)
and are small; see the full 167-line card for those if evaluating chat/analysis features.)*

---

## Our configuration cost — MEASURED from real billing (Jul 15, 2026)
These are **actual** per-minute costs computed from real Retell call charges, not the
component estimates. They differ from the sticker math because **TTS is billed on agent
speech time**, not total call duration.

| Config | Example call (dur, cost) | $/min measured | ₹/min (₹85/$) |
|---|---|---|---|
| gpt-4.1 + ElevenLabs (old) | call_287d24 (54s, $0.141) | ~$0.157 | ~₹13.3 |
| gpt-4.1 + ElevenLabs (old) | call_7a777c (74s, $0.188) | ~$0.152 | ~₹12.9 |
| **gpt-4o-mini + ElevenLabs (current)** | call_3f9701 (65s, $0.124) | **~$0.114** | **~₹9.7** |
| gpt-4o-mini + ElevenLabs (current) | call_27913 (101s, $0.185) | ~$0.110 | ~₹9.4 |
| gpt-4o-mini + platform voice | call_4a7055 (40s, $0.066) | ~$0.099 | ~₹8.4 |

**Active config ≈ $0.11/min Retell + ~₹1/min VoiceLink ≈ ₹10.4/min all-in.**
Per 1,000 calls (~2-min avg) ≈ **₹20,700 all-in**.

**Learnings:**
- **Model** is the real lever: gpt-4.1 → gpt-4o-mini saved ~$0.04/min (~27%).
- **Voice**: platform vs ElevenLabs is only ~$0.015–0.025/min in practice — not worth losing the
  Indian accent. Keep gpt-4o-mini + ElevenLabs Indian voice.
- Component estimate ($0.121/min) was close but slightly high vs measured (~$0.11); trust the
  measured figures above for budgeting.

**Per-call cost anatomy (from itemized billing, e.g. call_3f9701 @ 64s):**
| Line item | Cost | Type |
|---|---|---|
| retell_voice_engine | $0.055/min | per-minute (fixed core fee, biggest component) |
| TTS (elevenlabs_tts_03_2026) | $0.04/min | per-minute (only line that changes with voice) |
| gpt-4o-mini (conversation LLM) | $0.006/min | per-minute (negligible) |
| post_call_analysis | **~$0/call** | **flat per call** (was $0.015 on gpt-4.1 — optimized) |

**Optimizations applied (Indian voice kept):** conversation LLM and post-call-analysis model
both set to `gpt-4o-mini`. Floor for any config ≈ $0.061/min (engine + LLM) + TTS.

**Validated (call_40e47b, 73s, $0.1246):** the gpt-4.1 post-call line ($0.015) is gone — a 73s
call now costs the same as a 64s call did before, confirming the flat ~$0.015/call overhead was
removed. Effective active cost ≈ **$0.102/min Retell** (+ ~₹1/min VoiceLink ≈ ~₹9.7/min all-in).
