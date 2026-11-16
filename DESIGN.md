---
name: Basket Lab
description: Signage desk. Ink, enamel yellow, IBM Plex. Comparing baskets is the first viewport.
colors:
  paper: "#FFFFFF"
  paper-deep: "#F3F3F3"
  paper-well: "#FFFFFF"
  ink: "#121212"
  ink-soft: "#5E5E5E"
  steel: "#6B6B6B"
  primary: "#F5C400"
  primary-ink: "#121212"
  loss: "#B33A2B"
  rule: "#E8E8E8"
  overlay: "rgb(18 18 18 / 0.6)"
  paper-night: "#121212"
  paper-deep-night: "#0A0A0A"
  paper-well-night: "#1C1C1C"
  ink-night: "#F5F5F5"
  ink-soft-night: "#9A9A9A"
  gain-night: "#F5F5F5"
  loss-night: "#E07064"
  overlay-night: "rgb(0 0 0 / 0.72)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  amount:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "2.5rem"
    fontWeight: 500
    letterSpacing: "-0.03em"
rounded:
  sm: "0px"
  md: "2px"
  lg: "2px"
  btn: "2px"
---

# Design System: Basket Lab

## Overview

**Creative north star: enamel signage**

Basket Lab is a local Indian MF and ETF lab. The field is white `#FFFFFF`. Type is carbon ink. The only accent is enamel yellow `#F5C400` on LIVE, the active lumpsum plate, and the leader tick. IBM Plex Sans carries the UI; IBM Plex Mono carries rupees, rates, and AMFI codes. Night inverts the plate: black field, frost ink, the same yellow.

The first viewport is a league: one lead sentence, baskets as columns (BeES as a ghost reference), one growth chart. Settings are a thin instrument strip, not a card.

This look replaces the frost/teal/Geist desk. The information set and one-route lab stay.

## Colors

The interface is 90%+ ink on white. Yellow is not a series color and not a gain color.

- **Plate** `paper`: page, header.
- **Carbon ink** `ink`: type, hairlines, the ring mark, signed gains.
- **Enamel yellow** `primary`: LIVE, active lumpsum, leader tick.
- **Rust** `loss`: drawdown, BLACKOUT, trailing vs BeES.
- **Steel**: BeES reference and secondary series.

Night uses inverse tokens: field `#121212`, well `#1C1C1C`, ink frost. Yellow chrome stays.

## Typography

IBM Plex Sans is the only sans. Display weight is 400–500, tracking −0.02em. Sentence case. Labels are 13px, not tracked capitals. Numeric UI uses IBM Plex Mono: league CAGR, rupees, AMFI codes. The rupee sign sits in ink-soft.

## Layout

One centered column: `min(1360px, calc(100% - 5rem))`. Header is sticky, full bleed, white, 1px rule. No blur. Workspace nav is quiet text, not a well.

Compare is an instrument strip, a lead sentence, the league, then charts. Baskets and Insights remain reachable. The editor is a modal.

## Elevation

Hairline only. Overlay umbra on the modal. No card drop shadow.

## Shapes

Sharp: 0 / 2. Buttons 2px. Focus is a 2px ink ring, offset 2px.

## Do

- Keep yellow for LIVE, the active mode plate, and the leader tick.
- Keep comparison as columns on the first viewport.
- Keep missing NAV as empty copy, never zero.

## Don't

- Don't restore Groww green, frost teal, Geist, or 8px cards.
- Don't color signed gains teal or green.
- Don't add a marketing hero in front of the lab.
- Don't blur the header.
