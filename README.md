# Pixel Arcade mirror

Public frontend for [Pixel Arcade](https://pixelarcade.com.au/), including the featured Pixel Portal emulator.

This repository contains only public browser assets. Account passwords, private messages, databases and server credentials are not included. Account and community features connect to pixelarcade.com.au over HTTPS; a network blocking that domain may prevent those features from working. Network availability and third-party game availability vary.

The emulator accepts game files supplied locally by the player. No ROMs are bundled. Original asset licenses and attribution files are retained.

GitHub Pages deploys `site.tar.gz` through the Pages workflow. Build updates in the private source repository with `npm run build:pages`.
