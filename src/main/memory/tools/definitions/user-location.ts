/**
 * 用户位置工具
 *
 * 默认使用 IP 城市级近似定位；用户在设置中开启精准定位授权后，才尝试设备/系统 Geolocation。
 * 不写入数据库；支持环境变量覆盖：LINGYUE_USER_CITY / LINGYUE_USER_REGION / LINGYUE_USER_COUNTRY。
 */
import { net } from 'electron'
import { tool } from 'ai'
import { z } from 'zod'
import { getMainWindow } from '../../../windows/mainWindow'
import { store } from '../../../store'

export type UserLocationPrecision = 'auto' | 'device' | 'city'

export interface UserLocationResult {
  ok: boolean
  displayName: string
  city?: string
  region?: string
  country?: string
  countryCode?: string
  latitude?: number
  longitude?: number
  accuracyMeters?: number
  timezone?: string
  approximate: boolean
  source: string
  precision: 'device' | 'city' | 'timezone' | 'configured' | 'disabled'
  cached?: boolean
  error?: string
  warnings?: string[]
}

export interface LocationPrivacySettings {
  preciseLocationEnabled: boolean
}

export interface PreciseLocationAuthorizationResult {
  ok: boolean
  settings: LocationPrivacySettings
  location?: UserLocationResult
  error?: string
}

const DEVICE_LOCATION_CACHE_TTL_MS = 10 * 60 * 1000
const CITY_LOCATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000

let cachedLocation: { value: UserLocationResult; expiresAt: number } | null = null
let preciseLocationPromptAllowedUntil = 0

export function getLocationPrivacySettings(): LocationPrivacySettings {
  return {
    preciseLocationEnabled: store.get('privacySettings')?.preciseLocationEnabled === true,
  }
}

export function isPreciseLocationEnabled(): boolean {
  return getLocationPrivacySettings().preciseLocationEnabled
}

export function isPreciseLocationPermissionAllowed(): boolean {
  return isPreciseLocationEnabled() || Date.now() < preciseLocationPromptAllowedUntil
}

export function setPreciseLocationEnabled(enabled: boolean): LocationPrivacySettings {
  store.set('privacySettings', { preciseLocationEnabled: enabled })
  if (!enabled && cachedLocation?.value.precision === 'device') cachedLocation = null
  return getLocationPrivacySettings()
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function roundCoordinate(value?: number, decimals = 2): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function optionalEnvNumber(...names: string[]): number | undefined {
  for (const name of names) {
    const raw = envValue(name)
    if (!raw) continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'User-Agent': 'LavaDesk/1.0',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForMainWindowReady(): Promise<Electron.BrowserWindow> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) throw new Error('主界面未打开，无法请求设备定位。')
  if (!win.webContents.isLoading()) return win

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('主界面加载超时，无法请求设备定位。'))
    }, 10_000)
    const cleanup = () => {
      clearTimeout(timeout)
      win.webContents.off('did-finish-load', finish)
      win.webContents.off('did-fail-load', fail)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('主界面加载失败，无法请求设备定位。'))
    }
    win.webContents.once('did-finish-load', finish)
    win.webContents.once('did-fail-load', fail)
  })

  return win
}

function buildDisplayName(parts: { city?: string; region?: string; country?: string; timezone?: string }): string {
  const locationParts = [parts.city, parts.region, parts.country].filter(Boolean)
  if (locationParts.length > 0) return locationParts.join(', ')
  return parts.timezone || '未知位置'
}

function configuredLocation(): UserLocationResult | null {
  const city = envValue('LINGYUE_USER_CITY') || envValue('USER_LOCATION_CITY')
  if (!city) return null

  const region = envValue('LINGYUE_USER_REGION') || envValue('USER_LOCATION_REGION')
  const country = envValue('LINGYUE_USER_COUNTRY') || envValue('USER_LOCATION_COUNTRY')
  const timezone = envValue('LINGYUE_USER_TIMEZONE') || Intl.DateTimeFormat().resolvedOptions().timeZone
  const latitude = roundCoordinate(optionalEnvNumber('LINGYUE_USER_LATITUDE', 'USER_LOCATION_LATITUDE'))
  const longitude = roundCoordinate(optionalEnvNumber('LINGYUE_USER_LONGITUDE', 'USER_LOCATION_LONGITUDE'))

  return {
    ok: true,
    displayName: buildDisplayName({ city, region, country, timezone }),
    city,
    region: region || undefined,
    country: country || undefined,
    latitude,
    longitude,
    timezone,
    approximate: !(latitude != null && longitude != null),
    source: 'configured',
    precision: latitude != null && longitude != null ? 'device' : 'configured',
  }
}

function normalizeLocation(input: {
  city?: string
  region?: string
  country?: string
  countryCode?: string
  latitude?: number
  longitude?: number
  timezone?: string
  source: string
  approximate?: boolean
  precision?: UserLocationResult['precision']
  coordinateDecimals?: number
}): UserLocationResult {
  const timezone = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    ok: Boolean(input.city || input.region || input.country || timezone),
    displayName: buildDisplayName({ ...input, timezone }),
    city: input.city,
    region: input.region,
    country: input.country,
    countryCode: input.countryCode,
    latitude: roundCoordinate(input.latitude, input.coordinateDecimals ?? 2),
    longitude: roundCoordinate(input.longitude, input.coordinateDecimals ?? 2),
    timezone,
    approximate: input.approximate ?? true,
    source: input.source,
    precision: input.precision ?? 'city',
  }
}

async function reverseGeocode(latitude: number, longitude: number): Promise<Partial<UserLocationResult> | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: 'zh',
  })
  const data = asRecord(await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`))
  if (!data) return null

  return {
    city: stringValue(data, 'city') || stringValue(data, 'locality'),
    region: stringValue(data, 'principalSubdivision'),
    country: stringValue(data, 'countryName'),
    countryCode: stringValue(data, 'countryCode'),
  }
}

async function lookupDeviceGeolocation(): Promise<UserLocationResult> {
  const win = await waitForMainWindowReady()
  const result = asRecord(await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ ok: false, error: '当前运行环境不支持设备定位。' })
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          ok: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        }),
        (error) => resolve({ ok: false, code: error.code, error: error.message || '设备定位失败。' }),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 }
      )
    })
  `, true))

  if (result?.ok !== true) {
    throw new Error(stringValue(result, 'error') || '设备定位失败。')
  }

  const latitude = numberValue(result, 'latitude')
  const longitude = numberValue(result, 'longitude')
  if (latitude == null || longitude == null) throw new Error('设备定位没有返回坐标。')

  const warnings: string[] = []
  let place: Partial<UserLocationResult> | null = null
  try {
    place = await reverseGeocode(latitude, longitude)
  } catch (error) {
    warnings.push(`反向地理编码失败：${(error as Error).message}`)
  }

  const roundedLatitude = roundCoordinate(latitude, 5)
  const roundedLongitude = roundCoordinate(longitude, 5)
  const displayName = buildDisplayName(place ?? {}) !== '未知位置'
    ? buildDisplayName(place ?? {})
    : `纬度 ${roundedLatitude}, 经度 ${roundedLongitude}`

  return {
    ok: true,
    displayName,
    city: place?.city,
    region: place?.region,
    country: place?.country,
    countryCode: place?.countryCode,
    latitude: roundedLatitude,
    longitude: roundedLongitude,
    accuracyMeters: Math.round(numberValue(result, 'accuracyMeters') ?? 0) || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    approximate: false,
    source: 'device-geolocation',
    precision: 'device',
    warnings: warnings.length ? warnings : undefined,
  }
}

async function lookupIpWhoIs(): Promise<UserLocationResult> {
  const data = asRecord(await fetchJson('https://ipwho.is/?lang=zh-CN'))
  if (data?.success === false) throw new Error(stringValue(data, 'message') || 'ipwho.is 定位失败')
  const timezone = asRecord(data?.timezone)

  return normalizeLocation({
    city: stringValue(data, 'city'),
    region: stringValue(data, 'region'),
    country: stringValue(data, 'country'),
    countryCode: stringValue(data, 'country_code'),
    latitude: numberValue(data, 'latitude'),
    longitude: numberValue(data, 'longitude'),
    timezone: stringValue(timezone, 'id'),
    source: 'ipwho.is',
  })
}

async function lookupIpApi(): Promise<UserLocationResult> {
  const data = asRecord(await fetchJson('https://ipapi.co/json/'))
  const error = stringValue(data, 'error')
  if (error) throw new Error(stringValue(data, 'reason') || 'ipapi.co 定位失败')

  return normalizeLocation({
    city: stringValue(data, 'city'),
    region: stringValue(data, 'region'),
    country: stringValue(data, 'country_name'),
    countryCode: stringValue(data, 'country_code'),
    latitude: numberValue(data, 'latitude'),
    longitude: numberValue(data, 'longitude'),
    timezone: stringValue(data, 'timezone'),
    source: 'ipapi.co',
  })
}

async function lookupIpWhoisApp(): Promise<UserLocationResult> {
  const data = asRecord(await fetchJson('https://ipwhois.app/json/'))
  if (data?.success === false) throw new Error(stringValue(data, 'message') || 'ipwhois.app 定位失败')

  return normalizeLocation({
    city: stringValue(data, 'city'),
    region: stringValue(data, 'region'),
    country: stringValue(data, 'country'),
    countryCode: stringValue(data, 'country_code'),
    latitude: numberValue(data, 'latitude'),
    longitude: numberValue(data, 'longitude'),
    timezone: stringValue(data, 'timezone'),
    source: 'ipwhois.app',
  })
}

function timezoneFallback(warnings: string[]): UserLocationResult {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    ok: false,
    displayName: timezone || '未知位置',
    timezone,
    approximate: true,
    source: 'timezone',
    precision: 'timezone',
    error: '无法通过网络获取城市级位置，只能读取本机时区。',
    warnings,
  }
}

function formatDeviceLocationError(error: unknown): string {
  const message = (error as Error).message || '设备定位服务没有返回坐标。'
  if (/network service|query location/i.test(message)) {
    return '精准定位开启失败：Electron 的定位网络服务没有返回坐标。请确认 Windows 设置 > 隐私和安全性 > 位置 中已开启定位服务和桌面应用访问权限，然后重试。'
  }
  if (/permission|denied|用户拒绝|denied/i.test(message)) {
    return '精准定位开启失败：系统定位权限被拒绝。请在 Windows 定位设置中允许桌面应用访问位置，然后重试。'
  }
  return `精准定位开启失败：${message}`
}

function preciseLocationDisabledResult(): UserLocationResult {
  return {
    ok: false,
    displayName: '精准定位未开启',
    approximate: true,
    source: 'settings',
    precision: 'disabled',
    error: '精准定位未开启。请先在设置中打开精准定位并完成授权。',
  }
}

function preciseLocationErrorResult(error: unknown): UserLocationResult {
  return {
    ok: false,
    displayName: '精准定位不可用',
    approximate: true,
    source: 'device-geolocation',
    precision: 'disabled',
    error: formatDeviceLocationError(error),
  }
}

function canUseCachedLocation(value: UserLocationResult, precision: UserLocationPrecision, preciseEnabled: boolean): boolean {
  if (precision === 'device') return false
  if (precision === 'auto' && preciseEnabled) return false
  if (value.precision === 'device') return preciseEnabled && precision !== 'city'
  if (precision === 'city') return value.precision === 'city' || value.precision === 'configured'
  return value.precision !== 'timezone'
}

function cacheLocation(value: UserLocationResult): UserLocationResult {
  const ttl = value.precision === 'device' ? DEVICE_LOCATION_CACHE_TTL_MS : CITY_LOCATION_CACHE_TTL_MS
  cachedLocation = { value, expiresAt: Date.now() + ttl }
  return value
}

export async function getApproximateUserLocation(options: { refresh?: boolean; precision?: UserLocationPrecision } = {}): Promise<UserLocationResult> {
  const precision = options.precision ?? 'auto'
  const configured = configuredLocation()
  if (configured) return configured

  const preciseEnabled = isPreciseLocationEnabled()
  if (precision === 'device' && !preciseEnabled) return preciseLocationDisabledResult()

  const now = Date.now()
  if (!options.refresh && cachedLocation && cachedLocation.expiresAt > now && canUseCachedLocation(cachedLocation.value, precision, preciseEnabled)) {
    return { ...cachedLocation.value, cached: true }
  }

  const warnings: string[] = []
  if (precision !== 'city' && preciseEnabled) {
    try {
      return cacheLocation(await lookupDeviceGeolocation())
    } catch (error) {
      setPreciseLocationEnabled(false)
      if (precision === 'device') return preciseLocationErrorResult(error)
      warnings.push(formatDeviceLocationError(error))
    }
  }

  for (const lookup of [lookupIpWhoIs, lookupIpApi, lookupIpWhoisApp]) {
    try {
      const value = await lookup()
      if (value.ok && value.city) {
        if (warnings.length) value.warnings = [...(value.warnings ?? []), ...warnings]
        return cacheLocation(value)
      }
      warnings.push(`${value.source} 未返回可用城市`)
    } catch (error) {
      warnings.push((error as Error).message)
    }
  }

  const fallback = timezoneFallback(warnings)
  cachedLocation = { value: fallback, expiresAt: now + 10 * 60 * 1000 }
  return fallback
}

export async function requestPreciseLocationAuthorization(): Promise<PreciseLocationAuthorizationResult> {
  preciseLocationPromptAllowedUntil = Date.now() + 30_000
  try {
    const location = await lookupDeviceGeolocation()
    setPreciseLocationEnabled(true)
    cacheLocation(location)
    return { ok: true, settings: getLocationPrivacySettings(), location }
  } catch (error) {
    setPreciseLocationEnabled(false)
    return {
      ok: false,
      settings: getLocationPrivacySettings(),
      error: formatDeviceLocationError(error),
    }
  } finally {
    preciseLocationPromptAllowedUntil = 0
  }
}

export async function validatePreciseLocationEnabled(): Promise<PreciseLocationAuthorizationResult> {
  if (!isPreciseLocationEnabled()) {
    return { ok: false, settings: getLocationPrivacySettings(), error: '精准定位未开启。' }
  }

  try {
    const location = await lookupDeviceGeolocation()
    cacheLocation(location)
    return { ok: true, settings: getLocationPrivacySettings(), location }
  } catch (error) {
    setPreciseLocationEnabled(false)
    return { ok: false, settings: getLocationPrivacySettings(), error: formatDeviceLocationError(error) }
  }
}

export const userLocationTool = tool({
  description:
    '获取用户当前位置。默认仅使用粗略城市级位置；只有用户在设置中开启精准定位授权且实际获取设备坐标成功后，才会尝试设备/系统 Geolocation 高精度坐标。用于天气、本地时间、附近信息等需要位置但用户没有明确说明城市的场景。',
  inputSchema: z.object({
    refresh: z.boolean().default(false).describe('是否忽略缓存重新获取位置，默认 false'),
    precision: z.enum(['auto', 'device', 'city']).default('auto').describe('定位精度：auto 在设置授权后先设备后城市、未授权时只用城市级，device 只接受设备高精度授权/请求，city 只使用城市级定位'),
  }),
  execute: async ({ refresh, precision }) => getApproximateUserLocation({ refresh, precision }),
})