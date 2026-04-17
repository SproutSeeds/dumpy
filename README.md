<p align="center">
  <img src="https://raw.githubusercontent.com/SproutSeeds/dumpy/main/public/dumpy-sidescroll-full.gif?v=0.1.4" alt="Dumpy animation: Dump it. No matter the load. Dumpy takes the pressure off." width="520">
</p>

<h1 align="center">Dumpy</h1>

<p align="center">
  Dump it. No matter the load. Dumpy takes the pressure off.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/SproutSeeds/dumpy/main/public/dumpy-ui.png?v=0.1.5" alt="Dumpy web app showing a text dump box and file drop zone." width="760">
</p>

A tiny file, link, and text drop for a Tailscale tailnet.

## Install

```sh
npm install -g dumpy-files
dumpy-files
```

Or run it without installing:

```sh
npx dumpy-files
```

## Run

```sh
npm start
```

Dumpy listens on `http://127.0.0.1:7331`, stores uploaded files in `data/uploads` in the current working directory, and keeps the shared item list in `data/files.json`. File cards include both download and in-app preview actions.

Deleting a card moves it to Recently deleted for 30 days. Deleting it again from Recently deleted removes it for good, including the stored file if it has one.

## Serve On Tailscale

In another terminal:

```sh
tailscale serve --bg --https=7331 7331
tailscale serve status
```

Open the HTTPS URL from `tailscale serve status` on your phone or computer.

On this machine it is currently:

```text
https://codys-mac-studio-1.tail649edd.ts.net:7331/
```

To stop the Tailnet proxy:

```sh
tailscale serve --https=7331 off
```

## Options

```sh
DUMPY_PORT=8080 npm start
DUMPY_HOST=0.0.0.0 npm start
DUMPY_DATA_DIR=/Volumes/Code_2TB/code/dumpy-data npm start
```

Dumpy does not add its own login screen. Keep it on Tailscale unless you want everyone with the URL to upload and download files.
