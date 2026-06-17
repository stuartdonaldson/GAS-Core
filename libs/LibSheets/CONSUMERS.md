# LibSheets Consumers

Manual registry of projects depending on this library, until submodule wiring
makes this derivable from git directly (see GAS-Core-w0c and the submodule
follow-up). Update this file whenever a project migrates or pins a new version.

| Project | Path | Pinned version | Migrated? | bd issue |
|---|---|---|---|---|
| F3Go30 | `GApps/apps/F3Go30/script/libSheets.js` | unpinned (forked copy) | No | GAS-Core-9zj |
| Groups-Users | `GApps/apps/Groups-Users/scripts/libSheets.js` | unpinned (source of v1.0.0) | No | GAS-Core-82p |
| Group-Management | `GApps/apps/Group-Management/libSheets.js` | unpinned (forked copy, older API) | No | GAS-Core-1je |
| BreezeContactImporter | `GApps/apps/BreezeContactImporter/libSheets.js` | unpinned (forked copy, older API) | No | GAS-Core-brt |
| G-U-bkp | `GApps/apps/G-U-bkp/scripts/libSheets.js` | unpinned (forked copy, older API) | No | GAS-Core-het |
| Calendar Sync | `/mnt/c/dev/Calendar Sync/scripts/libSheets.js` | unpinned (forked copy, oldest) | No | GAS-Core-cia |
| GSlides | `/mnt/g/My Drive/Proj/GSlides/scripts/libSheets.js` | unpinned (forked copy, minimal) | No | GAS-Core-c4l |
| Worship Tools Calendar Sync | `/mnt/g/Shared Drives/Worship/10-Technology/Tools/Calendar Sync/` (+ `Calendar Sync 2`) | unpinned (forked copy) | No | GAS-Core-ydj |

Once a project migrates to a submodule/sync reference, update "Pinned version"
to the actual tag and "Migrated?" to Yes.
