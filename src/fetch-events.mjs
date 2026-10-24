// Pulls recent Ring camera events and stores each one as JSON plus its MP4 clip.
//
// Layout: $DATA_DIR/<camera>/<YYYY-MM-DD>/<HHMMSS>-<kind>-<ding_id>.{json,mp4}  (UTC)
//
// Safe to run repeatedly: events already stored are skipped, and clips that
// weren't ready yet are retried on later runs until MAX_VIDEO_ATTEMPTS.

import { RingApi } from 'ring-client-api'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import * as path from 'path'

const DATA_DIR = process.env.DATA_DIR ?? '/data'
const TOKEN_PATH = path.join(DATA_DIR, '.ring-token')

// Events older than this are never stored (this is also how far the first run goes back).
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 7)
// Keep re-checking recent events this long, so late-arriving clips get picked up.
const RECHECK_HOURS = Number(process.env.RECHECK_HOURS ?? 24)
const MAX_VIDEO_ATTEMPTS = 12
const PAGE_SIZE = 50

const log = (...args) => console.log(new Date().toISOString(), ...args)

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const eventBase = (cameraSlug, ev) => {
  const iso = new Date(ev.created_at).toISOString() // 2026-10-24T15:52:03.000Z
  const day = iso.slice(0, 10)
  const time = iso.slice(11, 19).replace(/:/g, '')
  return path.join(DATA_DIR, cameraSlug, day, `${time}-${ev.kind}-${ev.ding_id_str}`)
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'))

const writeJson = (p, obj) => {
  writeFileSync(p + '.tmp', JSON.stringify(obj, null, 2))
  renameSync(p + '.tmp', p)
}

const download = async (url, dest) => {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'))
  renameSync(dest + '.part', dest)
}

// Store one event. Returns true if it was already fully stored (JSON + clip settled).
const storeEvent = async (camera, cameraSlug, ev) => {
  const base = eventBase(cameraSlug, ev)
  const jsonPath = base + '.json'
  const mp4Path = base + '.mp4'

  let record = existsSync(jsonPath) ? readJson(jsonPath) : null
  if (record && record.video.status !== 'pending') return true

  mkdirSync(path.dirname(base), { recursive: true })
  if (!record) {
    record = {
      camera: { id: camera.id, name: camera.name },
      event: ev,
      storedAt: new Date().toISOString(),
      video: { status: 'pending', attempts: 0 },
    }
    log(`new ${ev.kind} event on ${camera.name} at ${ev.created_at} (${ev.ding_id_str})`)
  } else {
    record.event = ev // pick up updated recording_status etc.
  }

  if (ev.recording_status === 'ready') {
    record.video.attempts++
    try {
      const url = await camera.getRecordingUrl(ev.ding_id_str, { transcoded: false })
      await download(url, mp4Path)
      record.video = { status: 'stored', file: path.basename(mp4Path), attempts: record.video.attempts }
      log(`  saved clip ${path.relative(DATA_DIR, mp4Path)}`)
    } catch (err) {
      record.video.lastError = String(err?.message ?? err)
      log(`  clip download failed (attempt ${record.video.attempts}): ${record.video.lastError}`)
    }
  }

  const ageHours = (Date.now() - new Date(ev.created_at).getTime()) / 3.6e6
  if (record.video.status === 'pending' && (record.video.attempts >= MAX_VIDEO_ATTEMPTS || ageHours > RECHECK_HOURS)) {
    record.video.status = 'unavailable'
    log(`  giving up on clip for ${ev.ding_id_str} (recording_status=${ev.recording_status})`)
  }

  writeJson(jsonPath, record)
  return false
}

const syncCamera = async (camera) => {
  const cameraSlug = slug(camera.name)
  const hasHistory = existsSync(path.join(DATA_DIR, cameraSlug))
  const oldest = Date.now() - BACKFILL_DAYS * 864e5
  const recheckFrom = Date.now() - RECHECK_HOURS * 3.6e6

  let paginationKey
  let seen = 0
  for (;;) {
    const { events, meta } = await camera.getEvents({ limit: PAGE_SIZE, ...(paginationKey && { pagination_key: paginationKey }) })
    if (!events?.length) break

    // Events come newest first.
    let reachedOld = false
    for (const ev of events) {
      const createdAt = new Date(ev.created_at).getTime()
      if (createdAt < oldest) {
        reachedOld = true
        break
      }
      seen++
      const settled = await storeEvent(camera, cameraSlug, ev)
      // Once we're past the recheck window and hitting events we already have, we're caught up.
      if (hasHistory && settled && createdAt < recheckFrom) reachedOld = true
    }
    if (reachedOld || !meta?.pagination_key || meta.pagination_key === paginationKey) break
    paginationKey = meta.pagination_key
  }
  log(`${camera.name}: checked ${seen} events`)
}

const main = async () => {
  if (!existsSync(TOKEN_PATH)) throw new Error(`missing ${TOKEN_PATH} - run ring-auth-cli, see README.md`)

  const ringApi = new RingApi({ refreshToken: readFileSync(TOKEN_PATH, 'utf-8').trim() })

  // Ring rotates the refresh token on use; persist it or the next run fails.
  ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    writeFileSync(TOKEN_PATH, newRefreshToken)
    chmodSync(TOKEN_PATH, 0o600)
  })

  const cameras = await ringApi.getCameras()
  let failed = false
  for (const camera of cameras) {
    try {
      await syncCamera(camera)
    } catch (err) {
      failed = true
      log(`${camera.name}: failed: ${err?.message ?? err}`)
    }
  }
  ringApi.disconnect()
  return failed ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log(`fatal: ${err?.message ?? err}`)
    process.exit(1)
  })
