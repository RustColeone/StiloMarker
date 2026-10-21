# Libraries served from this app

Kept in the repository, pinned, so the app needs no CDN: it works offline
(the service worker keeps them across the app's versions) and in the desktop
build. Loaded only when needed (math in a preview; a Mermaid diagram). A
core library sits here; an extension's sits in its own folder (`vendor/`
inside it), so the core never names it.

| Library | Version | File | From | SHA-256 | License |
|---|---|---|---|---|---|
| MathJax | 3.2.2 | `vendor/mathjax/3.2.2/tex-svg.js` | `https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js` | `d4295dc33744836935c1399feece5159577b34c5c8ffb9f1c6324cd82e03a882` | Apache-2.0 (`LICENSE` beside it) |
| Mermaid | 11.17.2 | `extensions/mermaid/browser/vendor/mermaid/11.17.2/mermaid.min.js` | `https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js` | `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8` | MIT (`LICENSE` beside it) |

To update one: download the new version's file from its package, put it in a
folder named for the version (with its licence), update this table
(`sha256sum`) and the path in the code that loads it
(`app/modules/editor/adapters/preview.js`,
`extensions/mermaid/browser/adapters/library.js`), remove the old folder, and
run `node tools/protocol-sync.mjs` (an extension's libraries are listed for
the service worker). `tests/vendor.test.mjs` checks each file against its
SHA-256, and that the code and the service worker name exactly these.
