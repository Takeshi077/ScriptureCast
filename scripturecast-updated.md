# ScriptureCast — Product Requirements Document (Updated)

**Version:** 1.0 | **Status:** Draft | **Date:** 03/06/2026

---

## 1. Executive Summary

**Problem:** When pastors call out Bible verses during sermons, congregants scramble to find them in apps or Bibles, disrupting focus. Verses displayed manually by a technician are delayed, error-prone, and distract from the sermon flow.

**Solution:** An AI-powered system that listens to the pastor's live audio, instantly detects verse references, and displays the verse text on screens — with no human intervention required.

**Value Proposition:** Congregants stay engaged, verses appear within 2 seconds of being spoken, and pastors preach without technical distractions.

---

## 2. User Personas

| Persona | Needs | Pain Points |
|---|---|---|
| **Pastor** (primary) | Say verse — appears on screen. Cancel button if wrong. | Current system: must wait for tech. No training needed. |
| **Technical Director** | Monitor health, override, adjust sensitivity during service | No maintenance burden |
| **Congregant** | See verse clearly from any seat, enough time to read | Can't find verses in their own Bible fast enough |
| **Church Planter (buyer)** | Affordable ($500–1500), offline, simple hardware | Complex AV setups, recurring fees |

---

## 3. Functional Requirements

### 3.1 Audio Capture & Processing

| ID | Requirement | Priority |
|---|---|---|
| AC-01 | Accept live audio from standard XLR or USB microphone | P0 |
| AC-02 | Filter background music, congregation noise, reverb | P1 |
| AC-03 | <500ms latency from mic to transcription engine | P0 |
| AC-04 | Work offline (no internet) using local ASR model | P1 |

### 3.2 Verse Detection

| ID | Requirement | Priority |
|---|---|---|
| VD-01 | Detect verse references in natural speech ("John 3:16", "Romans 8, verse 28") | P0 |
| VD-02 | Recognize 66 books + common abbreviations (Gen, Jn, Rev, Psa) | P0 |
| VD-03 | Chapter-only references ("Turn to Genesis 1") → display first verse | P0 |
| VD-04 | Support verse ranges ("John 3:16–21") | P1 |
| VD-05 | Confidence threshold: 85% auto-display; 60–84% requires confirmation | P0 |

### 3.3 Verse Display

| ID | Requirement | Priority |
|---|---|---|
| DS-01 | Show reference in bold, 20% of screen height | P0 |
| DS-02 | Verse text minimum 72pt font (readable from 100ft) | P0 |
| DS-03 | Outputs: HDMI, NDI stream, web page URL, ProPresenter | P2 |
| DS-04 | Configurable duration (default 15 sec, 5–60 sec) | P1 |
| DS-05 | Pastor clears via foot pedal, wireless button, or mobile app | P1 |

### 3.4 Bible Data & Translations

| ID | Requirement | Priority |
|---|---|---|
| BD-01 | Include KJV + World English Bible (public domain) | P0 |
| BD-02 | Additional translations (ESV, NIV, NLT) — licensing required | P2 |
| BD-03 | Pastor can set default translation per service | P1 |
| BD-04 | Cache entire Bible locally for offline access | P0 |

### 3.5 Quote-to-Verse (Semantic Retrieval) – NEW FEATURE

| ID | Requirement | Priority |
|---|---|---|
| QV-01 | System shall detect when pastor quotes a Bible verse without citing reference | P0 |
| QV-02 | Match partial quotes (e.g., "love your neighbor as yourself" → Leviticus 19:18 or Matthew 22:39) | P0 |
| QV-03 | Handle paraphrased quotes (not exact wording) using semantic similarity | P1 |
| QV-04 | Display both the exact verse text AND the reference | P0 |
| QV-05 | If multiple possible verses match, show top 2–3 with confidence scores, or auto-select highest >90% | P1 |
| QV-06 | Pastor can train custom "favorite verses" for faster/higher-confidence matching | P2 |
| QV-07 | System shall prioritize verse matches from the same book/chapter pastor is currently preaching from (context awareness) | P1 |

---

## 4. Non-Functional Requirements

| Metric | Target |
|---|---|
| **Latency** | Audio → verse on screen <2 seconds (80th percentile), <3 sec max |
| **Precision** | Verse detection false positives > 95% (no false positives) |
| **Recall** | Catches intended verses > 90% |
| **Availability** | Uptime during service 99.9% |
| **Offline** | Full functionality without internet |
| **Hardware minimum** | CPU Intel i5 / Raspberry Pi 4 (8GB) |

---

## 5. Success Metrics (KPIs)

| Metric | Target |
|---|---|
| Detection latency (p95) | <3 sec |
| False positives per hour | <1 |
| Missed verses per service | <2 |
| Pastor satisfaction | 4/5 |
| Operator interventions per service | <3 |

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pastor speaks too fast / unclear | Training mode + adjustable sensitivity |
| Background music triggers false detection | Noise gate + bandpass filter (300Hz–3kHz focus on speech) |
| Offline ASR too slow on Raspberry Pi | Use smaller Whisper model (tiny.en); pre-warm model |
| Book name variations fail (e.g., "Song of Solomon") | Expand normalization table to 200+ variants |

---

## 7. Phased Roadmap

### Phase 1: MVP (2–3 months)
- Local microphone input
- Offline ASR (Whisper.cpp)
- 10 most common books + verse parsing
- KJV + WEB translations
- HDMI output + simple web display
- Wireless clear button

### Phase 2: Polished (1–2 months after MVP)
- 66 books + all abbreviations
- Operator dashboard
- Confidence-based confirmation mode
- ProPresenter integration
- Verse ranges

### Phase 3: Advanced (future)
- Multiple mic array
- Cloud dashboard (optional)
- Sermon verse history + export
- Mobile clear control

---

## 8. Out of Scope (MVP)

- Multi-language support (non-English Bibles)
- Voice commands beyond verse detection ("clear screen", "next verse")
- Automatic slide advance for worship software
- Mobile app for congregation (future companion app)
- Cloud dashboard across multiple churches

---

## 9. High-Level Architecture

```
[Microphone] → [Audio Interface] → [Local PC/Raspberry Pi]
                                         │
                              [Real-time ASR Engine]
                              (Whisper.cpp / Deepgram)
                                         │
                              [Verse Extraction Parser]
                               (Regex + Book Normalizer)
                                         │
                               [Bible SQLite Database]
                                         │
                                [WebSocket Server]
                                         │
[HDMI] → [Projector/TV]    ←    [Web Dashboard]
                                         │
                           [Wireless Button / Foot Pedal]
```

---

## 10. Hardware Tiers (Budget)

| Tier | Cost | Components |
|---|---|---|
| **Basic** | $300–400 | Raspberry Pi 4 (8GB), USB mic (Blue Snowball), wireless button |
| **Standard** | $700–900 | Intel NUC / mini PC, Shure MV7 mic, foot pedal, HDMI out |
| **Pro** | $1400–1800 | Dedicated fanless PC, wireless lapel mic, operator tablet, extra displays |

---

**Next Steps:** Build technical spike (offline Whisper on 10min of preaching audio) → source pilot church → finalize hardware bundle → develop MVP.

---

*ScriptureCast PRD — Proprietary & Confidential*
*For review and approval by product, engineering, and church partners.*
