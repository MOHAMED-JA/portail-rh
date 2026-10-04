---
name: design-md
description: Library of 74 ready-made DESIGN.md design systems (colors, typography, spacing, radius, components, layout rules) analyzed from well-known sites such as Stripe, Apple, Linear, Vercel, Notion, Airbnb, Spotify, Tesla, Revolut or Wise. Use when the user wants a page, app or component to look like a given brand or style ("comme Stripe", "style Apple", "look Linear"), wants to pick a design direction, or needs a DESIGN.md file for a project. Read the index, pick the closest system, then load only that reference file.
---

# DESIGN.md library

Source: [VoltAgent/awesome-design-md](https://github.com/voltagent/awesome-design-md) (MIT). Each file in `references/` is a plain-markdown
design system in the Google Stitch DESIGN.md format: a YAML front matter of tokens (colors, typography scale, spacing, radius, shadows)
followed by prose rules for layout, components, imagery and do / don't lists.

## How to use

1. **Pick a system.** Match the user's request against the index below (brand named directly, or mood: fintech, editorial, luxury
   automotive, developer tool, playful consumer…). If nothing is named and the choice matters, propose two or three fitting systems
   with one line each, or choose the closest one and say which.
2. **Load only what you need.** Read `references/<name>.md` for the chosen system — never load the whole folder (files are 4–60 KB each).
3. **Extract the tokens** (palette, type scale, spacing, radius, shadows) into CSS custom properties or the project's theme file
   before writing components, then follow the prose rules for layout, buttons, cards, navigation and imagery.
4. **Write a DESIGN.md for the project** when asked: copy the chosen reference to the project root as `DESIGN.md` and adapt
   the name, brand colors and fonts to the user's product.
5. **Keep it an inspiration, not a copy.** These are analyses of real brands: do not reuse their logos, product names, proprietary
   imagery or trademarked wording, and swap proprietary fonts (e.g. Söhne, SF Pro, Circular) for close open alternatives
   (Inter, Geist, Manrope, IBM Plex…). Keep the user's own brand colors when they have them; borrow structure, rhythm and polish.
6. **Respect the existing app.** When restyling an existing project, adapt the system to its components, accessibility (contrast ≥ 4.5:1
   for body text), dark mode and language/RTL needs instead of rewriting everything.

## Index (74 systems)

| Reference | Character |
|---|---|
| `airbnb` | A warm, generous consumer marketplace anchored on a clean white canvas and Airbnb Rausch (#ff385c), the single brand voltage that carries every primary CTA, search-button |
| `airtable` | A sober, editorial workflow-software interface anchored on white canvas and dark-ink type, where brand voltage comes from full-bleed signature cards in coral, dark green |
| `apple` | A photography-first interface that turns marketing into a museum gallery. |
| `binance` | A confident financial-platform interface anchored on a deep near-black canvas, where Binance's iconic yellow (#FCD535) carries every primary CTA, brand accent, and value- |
| `bmw` | BMW's corporate site |
| `bmw-m` | A motorsport-engineering interface anchored on a near-black canvas with white BMW Type Next Latin display headlines in confident UPPERCASE. |
| `bugatti` | An austere luxury-automotive interface that uses near-pure black canvas, white uppercase letterspaced display, and full-bleed automotive photography as the only voltage. |
| `cal` | A clean, calendar-software-first interface anchored on white canvas with black primary CTAs and custom Cal Sans display typography. |
| `claude` | A warm-canvas editorial interface for Anthropic's Claude product. |
| `clay` | A vibrant claymation-meets-data interface for Clay.com (GTM data-orchestration platform). |
| `clickhouse` | A high-performance database interface anchored on near-pure black canvas with electric yellow as the brand voltage. |
| `cohere` | Cohere's 2026 web system is a controlled enterprise AI interface built from stark white editorial space, deep green-black product bands, soft mineral surfaces, rounded me |
| `coinbase` | An institutional-grade crypto exchange whose marketing surfaces read like a quietly-confident financial-services brand. |
| `composio` | A developer-tools brand for AI-agent tool integration whose marketing surfaces lean into a dark, technical aesthetic with a single deep-electric-blue voltage (`#0007cd`). |
| `cursor` | An AI-first code editor whose marketing site reads like a quietly-confident developer-tools brand with a warm-cream editorial canvas (`#f7f7f4`) instead of the typical da |
| `dell-1996` | An inspired interpretation of Dell.com's 1996 design language |
| `elevenlabs` | A voice-AI brand whose marketing surfaces read like a quietly editorial print magazine. |
| `expo` | A React Native developer-platform whose marketing site reads like a quietly-confident infrastructure brand. |
| `ferrari` | A luxury-automotive brand whose marketing surfaces read as cinematic editorial. |
| `figma` | A confident black-and-white editorial frame interrupted by oversized, hand-cut pastel color blocks. |
| `framer` | A confident dark-canvas builder marketing site that treats the page like a working artboard |
| `hashicorp` | An enterprise-infrastructure marketing canvas built around a near-black ground (#000000) and a system of per-product accent colors |
| `hp` | An inspired interpretation of HP's design language |
| `ibm` | An enterprise-marketing canvas faithful to Carbon Design System: white surfaces, charcoal type, IBM Blue (#0f62fe) as the single confident accent, and a deliberately flat |
| `intercom` | An editorial customer-service marketing canvas built around a soft cream-white ground, charcoal type set in Saans (Intercom's proprietary geometric sans), and a single co |
| `kraken` |  |
| `lamborghini` |  |
| `linear.app` | A near-black product-focused marketing canvas built around #010102 (the deepest dark surface of any tool in this collection), light gray text (#f7f8f8), and the signature |
| `lovable` |  |
| `mastercard` |  |
| `meta` | Meta's design system spans hardware commerce (Quest VR, Ray-Ban Meta AI glasses) and brand surfaces with a confident product-merchandising voice. |
| `minimax` | MiniMax presents itself as a premium AI infrastructure brand through a striking duality |
| `mintlify` | Mintlify presents documentation infrastructure with a dual-mode aesthetic |
| `miro` | Miro presents itself as the AI-powered visual workspace through a confident, almost playful brand voice |
| `mistral.ai` | Mistral AI brands itself with a singular signature |
| `mongodb` | MongoDB carries a strong dual-mode visual identity |
| `nike` | | |
| `nintendo-2001` | An analysis of Nintendo.com's 2001 design language |
| `notion` | Notion presents itself as the all-in-one workspace through a confident, illustration-rich brand voice |
| `nvidia` | | |
| `ollama` | | |
| `opencode.ai` | | |
| `pinterest` | | |
| `playstation` | | |
| `posthog` | | |
| `raycast` | | |
| `renault` | | |
| `replicate` | | |
| `resend` | | |
| `revolut` | | |
| `runwayml` |  |
| `sanity` |  |
| `sentry` | An inspired interpretation of Sentri's design language |
| `shopify` | An inspired interpretation of Shopifi's design language |
| `slack` | An inspired interpretation of Slacc's design language |
| `spacex` | An inspired interpretation of Spasex's design language |
| `spotify` |  |
| `starbucks` |  |
| `stripe` | An inspired interpretation of Stripi's design language |
| `supabase` | An inspired interpretation of Supabaze's design language |
| `superhuman` | An inspired interpretation of Superhumon's design language |
| `tesla` |  |
| `theverge` |  |
| `together.ai` | An inspired interpretation of Together AI's design language |
| `uber` | An inspired interpretation of Uber's design language |
| `vercel` | An inspired interpretation of Vercel's design language |
| `vodafone` | An inspired interpretation of Vodafone's design language |
| `voltagent` | An inspired interpretation of Voltagent's design language |
| `warp` | An inspired interpretation of Warp's design language |
| `webflow` | An inspired interpretation of Webflow's design language |
| `wired` | An inspired interpretation of Wired's design language |
| `wise` | An inspired interpretation of Wise's design language |
| `x.ai` | An inspired interpretation of xAI's design language |
| `zapier` | An inspired interpretation of Zapier's design language |
