# Media Studio design context

## Overview

The existing interface is an operational creative tool and media library. This
file records the current implementation for orientation; the owner has
explicitly requested substantial visual and interaction improvement, so it is
not approval of the existing interface or a prohibition on redesign.

## Colors

`public/studio.css` is the current source of truth for light and dark theme
variables: paper and ink neutrals, a warm orange accent, teal links and explicit
danger and success colours. Respect readable contrast in every state, including
hover, selected, focus and disabled states; do not infer acceptance from tokens.

## Typography

The current implementation uses Space Grotesk for headings and system UI fonts
for controls and body text. Keep text readable and information hierarchy clear
at desktop and phone widths.

## Layout

Give media, prompts and editing controls enough room to work; make navigation
and the path back to App Composer obvious. Preserve state when a user changes
views or dismisses a dialog. The owner wants a notably better Studio experience,
not a token-only restyle of the rejected layout.

## Components

Existing library, viewer and creation components live under `src/frontend/`;
shared behaviour and fallback paths remain in `public/studio.js`. Forms need
clear labels, useful errors, keyboard operation, visible focus and safe,
understandable dismissal. Every paid or public action should describe its real
consequence and current state.

## Do's and Don'ts

- Lead with the creator's actual media and useful next action.
- Use the owner's existing project artwork and maintain its provenance.
- Inspect rendered interactions in light and dark themes at representative
  phone and desktop sizes.
- Do not claim a model, workflow or visual treatment is approved or proven
  without the corresponding evidence.
