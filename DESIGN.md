---
name: Basket Lab
description: Frost desk, teal accent, Geist. Comparing baskets is the first viewport.
colors:
  paper: "#F7F9FA"
  paper-deep: "#ECF0F2"
  paper-well: "#FFFFFF"
  ink: "#1F3038"
  ink-soft: "#5D6B72"
  primary: "#0D7480"
  primary-ink: "#FFFFFF"
  loss: "#B54A42"
  rule: "color-mix(in srgb, #1F3038 12%, transparent)"
  overlay: "rgb(31 48 56 / 0.42)"
  paper-night: "#1F3038"
  paper-deep-night: "#16252C"
  paper-well-night: "#2C3C44"
  ink-night: "#F7F9FA"
  ink-soft-night: "#9EA7AB"
  gain-night: "#8EC9CE"
  loss-night: "#E8A39C"
  overlay-night: "rgb(0 0 0 / 0.62)"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.035em"
    fontFeature: '"tnum" 1, "lnum" 1'
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  amount:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "1.45rem"
    fontWeight: 500
    letterSpacing: "-0.035em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  btn: "4px"
---

# Design System: Basket Lab

## Overview

**Creative north star: frost desk, teal tape**

Basket Lab is a local Indian MF and ETF lab. The field is frost `#F7F9FA`. Content sits on white wells with 8px corners and a 12% ink hairline. One accent: teal `#0D7480` on Share, LIVE, focus, and signed gains. Geist 400–500 carries the UI; Geist Mono carries amounts. Night is the same slate ink, inverted.

The first viewport is comparison. A sticky opaque bar holds the ring mark, Insights, teal Share, and LIVE. Under it: settings, four KPIs, the performance table, two chart cards.

This look was dealt for fintech (tasteskill cool-white-slate, Geist, sharp, tonal). It replaces the Groww mint/green/Inter desk. The information set and one-route lab stay.

## Colors

The interface is 90%+ neutral. Teal is the only accent.

- **Frost field** `paper`: page, header, input wells.
- **Slate ink** `ink`: type, hairlines, the ring mark.
- **Teal** `primary` / `gain`: Share, LIVE, focus, positive CAGR/XIRR/totals.
- **Brick** `loss`: negative returns, drawdown, alerts.
- **White well**: cards, table, charts, modal, sheet.

Night uses inverse tokens: field `#1F3038`, well `#2C3C44`, ink frost, gain lifted to `#8EC9CE`. Primary chrome stays teal.

Series swatches are teal, slate, gold, brick, sage, clay. No violet.

## Typography

Geist is the only sans. Display weight is 500, tracking −0.035em. Sentence case. Labels are 13px/500, not tracked capitals. Numeric UI uses lining tabular figures; KPI values and the amount use Geist Mono.

## Layout

One centered column: `min(1120px, calc(100% - 2.5rem))`. Header is sticky, full bleed, opaque frost with a 1px hairline, padded so its content lines up with the column. No blur, no floating pill.

Three workspaces in the header: Compare, Baskets, Insights. Compare is settings, KPIs, table, charts, yearly ranking. Baskets is the list plus share URL. Insights is a page, not a sheet. The editor is a modal.

## Elevation

Hairline only on wells. Overlay umbra on the modal and insights sheet. No card drop shadow.

## Shapes

Sharp scale: 4 / 6 / 8. Buttons 4px. Allocation meters and color dots stay circular. Focus is a 2px teal ring, offset 2px.

## Motion

Hover (fine pointer only): controls step 1px up; filled teal steps 14% toward ink. Press: 1px down, scale 0.985, 90ms. Header name enters once on load. `prefers-reduced-motion` kills animation and transition.

## Do

- Keep teal for Share, LIVE, focus, and signed gains.
- Keep the ring mark in ink, not a filled badge.
- Keep comparison in the first viewport.

## Don't

- Don't restore Groww green, mint field, Inter, or 16px cards.
- Don't use violet in chrome or series swatches.
- Don't add a marketing hero in front of the lab.
- Don't blur the header.
