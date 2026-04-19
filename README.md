<p align="center">
  <img src="https://raw.githubusercontent.com/SproutSeeds/dumpy/main/public/dumpy-sidescroll-full.gif?v=0.1.4" alt="Dumpy animation: Dump it. No matter the load. Dumpy takes the pressure off." width="520">
</p>

<h1 align="center">Dumpy</h1>

<p align="center">
  Dump it. No matter the load. Dumpy takes the pressure off.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/SproutSeeds/dumpy/main/public/dumpy-ui.png?v=0.2.1" alt="Dumpy web app showing a text dump box, dump party tools, and file drop zone." width="760">
</p>

A tiny file, link, and text drop for a Tailscale tailnet.

## Official Phone URL

Save this URL to your iPhone Home Screen:

```text
https://dumpy.tail649edd.ts.net
```

Dumpy is tailnet-only. Open the Tailscale app and make sure you are connected before using it from mobile.
Delete older iPhone Home Screen shortcuts that include a port number.

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

Dumpy listens on `http://127.0.0.1:7331`. File cards include download and in-app preview actions, and the active storage folder is shown in the app.

By default, Dumpy stores data in the normal app-data folder for your OS:

- macOS: `~/Library/Application Support/Dumpy`
- Linux: `~/.local/share/dumpy`
- Windows: `%APPDATA%\Dumpy`

Use `--data-dir` or `DUMPY_DATA_DIR` to keep all dumps on an external SSD or another chosen folder.

Dump Parties group related files, links, and text blobs. Folder uploads are stored as individual files with their relative paths remembered, so one file can still be previewed or downloaded without downloading the whole party. A party can also be downloaded as a zip when you want the full bundle.

Deleting a card moves it to Recently deleted for 30 days. Deleting it again from Recently deleted removes it for good, including the stored file if it has one.

## Serve On Tailscale

For this hosted Dumpy instance, the shared Tailscale live-app-host routes:

```text
https://dumpy.tail649edd.ts.net -> http://127.0.0.1:7331
```

The local Dumpy service stays bound to `127.0.0.1:7331`.

Do not enable public Tailscale Funnel for Dumpy.

## Health And Access Check

```sh
curl https://dumpy.tail649edd.ts.net/healthz
npm run doctor:secure
```

The health response includes the app name and version:

```json
{
  "ok": true,
  "app": "dumpy",
  "version": "0.2.1"
}
```

## Options

```sh
DUMPY_PORT=8080 dumpy-files
DUMPY_HOST=127.0.0.1 dumpy-files
dumpy-files --data-dir /Volumes/Samsung_T7/Dumpy
DUMPY_DATA_DIR=/Volumes/Samsung_T7/Dumpy dumpy-files
```

Dumpy does not add its own login screen. Keep it on Tailscale and keep the local app bound to localhost or another private interface.

## Updates

Hosted phone users get app updates after the running Dumpy service is updated and restarted.
Package users need a separate Dumpy npm release.
Publishing or updating Clawdad does not update Dumpy.
