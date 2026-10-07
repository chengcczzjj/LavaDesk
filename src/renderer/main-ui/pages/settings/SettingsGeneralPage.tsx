import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  List,
  Zap,
  Power,
  Monitor,
  Sparkles,
  Globe,
  ExternalLink,
  MapPin,
  RefreshCw,
  Download,
  RotateCcw,
} from 'lucide-react'
import type { AppUpdateStatus, ModelProfile, ModelProvider } from '@shared/types'
import { DEEPSEEK_API_BASE_URL, DEEPSEEK_LATEST_MODEL } from '@shared/model-defaults'
import './settings.css'

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  'openai-compatible': 'OpenAI 兼容',
  'deepseek': 'DeepSeek',
  'google': 'Google Gemini',
}

function formatUpdateCheckTime(timestamp?: number): string {
  if (!timestamp) return '尚未完成检查'
  return `上次检查：${new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)}`
}

/** Strip Electron's "Error invoking remote method …: Error:" prefix so users see the real reason. */
function formatIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const cleaned = message.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '').trim()
  if (!cleaned) return fallback
  // zod issues arrive as a JSON array; the profile form checks required fields itself.
  return cleaned.startsWith('[') ? fallback : cleaned
}

function getIncompleteProfileReason(profile: ModelProfile): string {
  if (!profile.name.trim()) return '请填写配置名称'
  if (!profile.model.trim()) return '请填写或从列表选择模型'
  return ''
}

export function SettingsGeneralPage() {
  /* ── General settings state ── */
  const [autoStart, setAutoStart] = useState(false)
  const [autoStartBusy, setAutoStartBusy] = useState(false)
  const [autoStartMessage, setAutoStartMessage] = useState('')
  const [preciseLocationEnabled, setPreciseLocationEnabled] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [showLocationSettingsAction, setShowLocationSettingsAction] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateActionBusy, setUpdateActionBusy] = useState(false)
  const [updateActionError, setUpdateActionError] = useState('')

  /* ── Model profiles state ── */
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelListError, setModelListError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [activeId, setActiveId] = useState('')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  // Click outside to close model dropdown
  useEffect(() => {
    if (!showModelDropdown) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelDropdown])

  const loadProfiles = useCallback(async () => {
    const list = await window.lingyue.chat.listProfiles()
    setProfiles(list)
    const active = await window.lingyue.chat.getActiveProfile()
    // Clear the badge when the active profile was deleted.
    setActiveId(active?.id ?? '')
  }, [])

  useEffect(() => {
    let canceled = false
    window.lingyue.app.getUpdateStatus()
      .then((status) => {
        if (!canceled) setUpdateStatus(status)
      })
      .catch((error) => {
        if (!canceled) setUpdateActionError((error as Error).message || '更新状态读取失败。')
      })
    const offUpdate = window.lingyue.app.onUpdateStateChanged((status) => {
      if (canceled) return
      setUpdateStatus(status)
      setUpdateActionError('')
    })
    return () => {
      canceled = true
      offUpdate()
    }
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    let canceled = false
    window.lingyue.app.getLaunchAtLogin()
      .then((launchStatus) => {
        if (canceled) return
        setAutoStart(launchStatus.enabled)
        setAutoStartMessage(launchStatus.message || '')
      })
      .catch((error) => {
        if (!canceled) setAutoStartMessage((error as Error).message || '开机启动设置读取失败。')
      })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    let canceled = false
    window.lingyue.app.getLocationSettings()
      .then(async (settings) => {
        if (canceled) return
        setPreciseLocationEnabled(settings.preciseLocationEnabled)
        if (!settings.preciseLocationEnabled) return

        setLocationBusy(true)
        setLocationMessage('正在验证精准定位是否可用')
        const result = await window.lingyue.app.validatePreciseLocation()
        if (canceled) return
        setPreciseLocationEnabled(result.settings.preciseLocationEnabled)
        if (result.ok) {
          const accuracy = result.location?.accuracyMeters
          setLocationMessage(accuracy ? `已验证，当前精度约 ${Math.round(accuracy)} 米` : '已验证精准定位可用')
          setShowLocationSettingsAction(false)
        } else {
          setLocationMessage(result.error || '精准定位验证失败')
          setShowLocationSettingsAction(true)
        }
      })
      .catch(() => setLocationMessage('定位设置读取失败'))
      .finally(() => {
        if (!canceled) setLocationBusy(false)
      })
    return () => { canceled = true }
  }, [])

  /* ── Profile actions ── */
  const handleNewProfile = (provider: ModelProvider = 'openai-compatible') => {
    setEditingProfile({
      id: `profile-${Date.now()}`,
      name: provider === 'google' ? 'Gemini' : '',
      provider,
      baseURL: '',
      apiKey: '',
      model: provider === 'google' ? 'gemini-2.5-flash' : '',
    })
    setTestStatus('idle')
    setModels([])
    setModelListError('')
    setShowModelDropdown(false)
  }

  const handleNewDeepSeekProfile = () => {
    setEditingProfile({
      id: `profile-${Date.now()}`,
      name: 'DeepSeek',
      provider: 'deepseek',
      baseURL: DEEPSEEK_API_BASE_URL,
      apiKey: '',
      model: DEEPSEEK_LATEST_MODEL,
    })
    setTestStatus('idle')
    setModels([])
    setModelListError('')
    setShowModelDropdown(false)
  }

  const handleEditProfile = (p: ModelProfile) => {
    setEditingProfile({ ...p })
    setTestStatus('idle')
    setModels(p.availableModels ?? [])
    setModelListError('')
    setShowModelDropdown(false)
  }

  const showProfileError = (message: string) => {
    setTestStatus('error')
    setTestError(message)
  }

  const handleSave = async () => {
    if (!editingProfile || savingProfile) return
    const incomplete = getIncompleteProfileReason(editingProfile)
    if (incomplete) {
      showProfileError(incomplete)
      return
    }
    setSavingProfile(true)
    try {
      await window.lingyue.chat.upsertProfile(editingProfile)
      await loadProfiles()
      setEditingProfile(null)
    } catch (error) {
      showProfileError(formatIpcError(error, '保存失败'))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleDelete = async (id: string) => {
    const profile = profiles.find((item) => item.id === id)
    if (!window.confirm(`删除模型配置“${profile?.name || '未命名配置'}”？API Key 也会一并移除。`)) return
    await window.lingyue.chat.deleteProfile(id)
    await loadProfiles()
    if (editingProfile?.id === id) setEditingProfile(null)
  }

  const handleSetActive = async (id: string) => {
    await window.lingyue.chat.setActiveProfile(id)
    setActiveId(id)
  }

  const handleTest = async () => {
    if (!editingProfile) return
    const incomplete = getIncompleteProfileReason(editingProfile)
    if (incomplete) {
      showProfileError(incomplete)
      return
    }
    setTestStatus('testing')
    setTestError('')
    try {
      const result = await window.lingyue.chat.testProfile(editingProfile)
      if (result.ok) {
        setTestStatus('success')
      } else {
        showProfileError(result.error || '连接失败')
      }
    } catch (error) {
      showProfileError(formatIpcError(error, '连接失败'))
    }
  }

  const handleListModels = async () => {
    if (!editingProfile) return
    const profile = editingProfile
    setModelsLoading(true)
    setModelListError('')
    try {
      const result = await window.lingyue.chat.listModels(profile)
      setModels(result.models)
      setShowModelDropdown(false)
      if (result.error) setModelListError(result.error)
      setEditingProfile((current) => (current?.id === profile.id ? { ...current, availableModels: result.models } : current))
    } catch (error) {
      setModelListError(formatIpcError(error, '获取模型列表失败'))
    } finally {
      setModelsLoading(false)
    }
  }

  const selectModel = (model: string) => {
    if (!editingProfile) return
    setEditingProfile({ ...editingProfile, model })
    setShowModelDropdown(false)
  }

  const updateField = <K extends keyof ModelProfile>(key: K, value: ModelProfile[K]) => {
    if (!editingProfile) return
    setEditingProfile({ ...editingProfile, [key]: value })
  }

  const handlePreciseLocationToggle = async (enabled: boolean) => {
    if (locationBusy) return
    setLocationBusy(true)
    setLocationMessage('')

    try {
      if (!enabled) {
        const result = await window.lingyue.app.setPreciseLocationEnabled(false)
        setPreciseLocationEnabled(result.settings.preciseLocationEnabled)
        setLocationMessage('已关闭精准定位，将只使用粗略位置')
        setShowLocationSettingsAction(false)
        return
      }

      const result = await window.lingyue.app.requestPreciseLocationAuthorization()
      setPreciseLocationEnabled(result.settings.preciseLocationEnabled)
      if (result.ok) {
        const accuracy = result.location?.accuracyMeters
        setLocationMessage(accuracy ? `已开启，当前精度约 ${Math.round(accuracy)} 米` : '已开启精准定位')
        setShowLocationSettingsAction(false)
      } else {
        setLocationMessage(result.error || '精准定位开启失败')
        setShowLocationSettingsAction(true)
      }
    } catch (error) {
      setPreciseLocationEnabled(false)
      setLocationMessage((error as Error).message || '定位授权失败')
      setShowLocationSettingsAction(false)
    } finally {
      setLocationBusy(false)
    }
  }

  const handleAutoStartToggle = async (enabled: boolean) => {
    if (autoStartBusy) return
    setAutoStartBusy(true)
    setAutoStartMessage('')
    try {
      const result = await window.lingyue.app.setLaunchAtLogin(enabled)
      setAutoStart(result.enabled)
      setAutoStartMessage(result.message || (result.enabled ? '已启用开机自启动' : '已关闭开机自启动'))
    } catch (error) {
      setAutoStartMessage((error as Error).message || '开机启动设置失败')
    } finally {
      setAutoStartBusy(false)
    }
  }

  const handleUpdateAction = async () => {
    if (!updateStatus || updateActionBusy) return
    if (['checking', 'downloading', 'installing'].includes(updateStatus.phase)) return

    setUpdateActionBusy(true)
    setUpdateActionError('')
    try {
      if (updateStatus.phase === 'downloaded') {
        const started = await window.lingyue.app.installUpdate()
        if (!started) setUpdateActionError('更新安装器尚未准备好，请重新检查更新。')
        return
      }

      const shouldDownload = updateStatus.phase === 'available' || (
        updateStatus.phase === 'error' && Boolean(updateStatus.availableVersion)
      )
      const nextStatus = shouldDownload
        ? await window.lingyue.app.downloadUpdate()
        : await window.lingyue.app.checkForUpdates()
      setUpdateStatus(nextStatus)
    } catch (error) {
      setUpdateActionError((error as Error).message || '更新操作失败，请稍后重试。')
    } finally {
      setUpdateActionBusy(false)
    }
  }

  const updateWorking = updateActionBusy || Boolean(
    updateStatus && ['checking', 'downloading', 'installing'].includes(updateStatus.phase)
  )
  const updateActionLabel = !updateStatus
    ? '读取中'
    : updateStatus.phase === 'unsupported'
      ? '仅正式版可用'
      : updateStatus.phase === 'checking'
        ? '检查中'
        : updateStatus.phase === 'downloading'
          ? `下载中 ${Math.round(updateStatus.progressPercent || 0)}%`
          : updateStatus.phase === 'installing'
            ? '正在安装'
            : updateStatus.phase === 'downloaded'
              ? '重启并安装'
              : updateStatus.phase === 'available' || (updateStatus.phase === 'error' && updateStatus.availableVersion)
                ? `下载 v${updateStatus.availableVersion}`
                : '检查更新'
  const UpdateActionIcon = updateWorking
    ? Loader2
    : updateStatus?.phase === 'downloaded'
      ? RotateCcw
      : updateStatus?.phase === 'available'
        ? Download
        : RefreshCw

  return (
    <div className="settings-scroll">
      {/* ════════ 版本与更新 ════════ */}
      <div className="settings-group">
        <div className="settings-group__header">版本与更新</div>
        <div className="settings-card settings-update-card">
          <div className="settings-card__icon"><RefreshCw size={18} /></div>
          <div className="settings-card__body" aria-live="polite">
            <div className="settings-card__title">
              LavaDesk v{updateStatus?.currentVersion || '—'}
            </div>
            <div className="settings-card__desc settings-update-card__message">
              {updateActionError || updateStatus?.message || '正在读取更新状态…'}
            </div>
            <div className="settings-update-card__meta">
              {formatUpdateCheckTime(updateStatus?.lastCheckedAt)}
            </div>
            {updateStatus?.phase === 'downloading' && (
              <div className="settings-update-card__progress" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, updateStatus.progressPercent || 0))}%` }} />
              </div>
            )}
          </div>
          <div className="settings-card__action">
            <button
              type="button"
              className="settings-btn settings-btn--primary settings-update-card__button"
              disabled={!updateStatus || updateStatus.phase === 'unsupported' || updateWorking}
              onClick={handleUpdateAction}
            >
              <UpdateActionIcon size={14} className={updateWorking ? 'spin' : undefined} />
              {updateActionLabel}
            </button>
          </div>
        </div>
      </div>

      {/* ════════ 外观与行为 ════════ */}
      <div className="settings-group">
        <div className="settings-group__header">外观与行为</div>

        {/* 开机自启动 */}
        <div className="settings-card">
          <div className="settings-card__icon"><Power size={18} /></div>
          <div className="settings-card__body">
            <div className="settings-card__title">开机自启动</div>
            <div className="settings-card__desc">系统启动时自动运行 LavaDesk</div>
            {autoStartMessage && <div className="settings-card__desc settings-card__desc--status">{autoStartMessage}</div>}
          </div>
          <div className="settings-card__action">
            {autoStartBusy && <Loader2 size={14} className="spin" />}
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={autoStart}
                disabled={autoStartBusy}
                onChange={(e) => handleAutoStartToggle(e.target.checked)}
              />
              <div className="toggle-switch__track">
                <div className="toggle-switch__thumb" />
              </div>
            </label>
          </div>
        </div>

        {/* 系统托盘 */}
        <div className="settings-card">
          <div className="settings-card__icon"><Monitor size={18} /></div>
          <div className="settings-card__body">
            <div className="settings-card__title">系统托盘图标</div>
            <div className="settings-card__desc">LavaDesk 常驻系统托盘，用于打开主界面和退出应用，不能关闭</div>
          </div>
          <div className="settings-card__action">
            <label className="toggle-switch toggle-switch--disabled" title="托盘是关闭主界面后唯一的入口">
              <input type="checkbox" checked disabled readOnly aria-label="系统托盘图标" />
              <div className="toggle-switch__track">
                <div className="toggle-switch__thumb" />
              </div>
            </label>
          </div>
        </div>

        {/* 动画效果 */}
        <div className="settings-card">
          <div className="settings-card__icon"><Sparkles size={18} /></div>
          <div className="settings-card__body">
            <div className="settings-card__title">动画效果</div>
            <div className="settings-card__desc">启用 UI 动画和过渡效果（即将推出）</div>
          </div>
          <div className="settings-card__action">
            <label className="toggle-switch toggle-switch--disabled" title="即将推出">
              <input type="checkbox" checked disabled readOnly aria-label="动画效果" />
              <div className="toggle-switch__track">
                <div className="toggle-switch__thumb" />
              </div>
            </label>
          </div>
        </div>

        {/* 语言 */}
        <div className="settings-card">
          <div className="settings-card__icon"><Globe size={18} /></div>
          <div className="settings-card__body">
            <div className="settings-card__title">语言</div>
            <div className="settings-card__desc">应用显示语言（更多语言即将推出）</div>
          </div>
          <div className="settings-card__action">
            <select className="settings-select" value="zh-CN" disabled aria-label="语言">
              <option value="zh-CN">简体中文</option>
            </select>
          </div>
        </div>
      </div>

      {/* ════════ 隐私与定位 ════════ */}
      <div className="settings-group">
        <div className="settings-group__header">隐私与定位</div>

        <div className="settings-card">
          <div className="settings-card__icon"><MapPin size={18} /></div>
          <div className="settings-card__body">
            <div className="settings-card__title">精准定位授权</div>
            <div className="settings-card__desc">
              默认关闭时 AI 只使用粗略位置；开关只有在实际获取设备坐标成功后才会开启
            </div>
            {locationMessage && <div className="settings-card__desc settings-card__desc--status">{locationMessage}</div>}
            {showLocationSettingsAction && (
              <button className="settings-btn settings-btn--sm location-settings-btn" onClick={() => window.lingyue.app.openLocationSettings()}>
                <ExternalLink size={12} /> 打开 Windows 定位设置
              </button>
            )}
          </div>
          <div className="settings-card__action">
            {locationBusy && <Loader2 size={14} className="spin" />}
            <label className={`toggle-switch ${locationBusy ? 'toggle-switch--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={preciseLocationEnabled}
                disabled={locationBusy}
                onChange={(e) => handlePreciseLocationToggle(e.target.checked)}
              />
              <div className="toggle-switch__track">
                <div className="toggle-switch__thumb" />
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ════════ 模型配置 ════════ */}
      <div className="settings-group">
        <div className="settings-group__header">模型配置</div>

        {/* Profile 列表 */}
        <div className="model-profiles">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`model-profile-card ${activeId === p.id ? 'model-profile-card--active' : ''}`}
              onClick={() => handleEditProfile(p)}
            >
              <div className="model-profile-card__indicator" />
              <div className="model-profile-card__info">
                <div className="model-profile-card__name">
                  {p.provider === 'google' ? (p.model || 'Gemini') : (p.name || '未命名')}
                </div>
                <div className="model-profile-card__meta">
                  <span className="model-profile-card__provider-badge">
                    {PROVIDER_LABELS[p.provider || 'openai-compatible']}
                  </span>
                  <span>{p.model}</span>
                </div>
              </div>
              <div className="model-profile-card__actions">
                {activeId !== p.id && (
                  <button
                    className="model-profile-card__btn model-profile-card__btn--activate"
                    onClick={(e) => { e.stopPropagation(); handleSetActive(p.id) }}
                    title="设为激活"
                  >
                    <Zap size={14} />
                  </button>
                )}
                <button
                  className="model-profile-card__btn model-profile-card__btn--danger"
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {profiles.length === 0 && (
            <div className="profile-empty">暂无模型配置，点击下方按钮添加</div>
          )}
        </div>

        {/* 新增按钮 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="settings-btn settings-btn--sm" onClick={() => handleNewProfile('openai-compatible')}>
            <Plus size={14} /> OpenAI 兼容
          </button>
          <button className="settings-btn settings-btn--sm" onClick={handleNewDeepSeekProfile}>
            <Plus size={14} /> DeepSeek
          </button>
          <button className="settings-btn settings-btn--sm" onClick={() => handleNewProfile('google')}>
            <Plus size={14} /> Google Gemini
          </button>
        </div>

        {/* 编辑面板 */}
        {editingProfile && (
          <div className="profile-editor">
            <h4 className="profile-editor__title">
              {editingProfile.provider === 'google'
                ? '配置 Google Gemini'
                : editingProfile.name ? `编辑 — ${editingProfile.name}` : '新建配置'}
            </h4>
            <div className="profile-editor__grid">
              {/* 名称 + Provider — 仅 OpenAI 兼容 & DeepSeek 时显示 */}
              {editingProfile.provider !== 'google' && (
                <>
                  <div className="form-field">
                    <label className="form-field__label">名称</label>
                    <input
                      className="form-field__input"
                      type="text"
                      value={editingProfile.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="DeepSeek V4 Flash"
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-field__label">提供商</label>
                    <select
                      className="settings-select"
                      value={editingProfile.provider}
                      onChange={(e) => {
                        const provider = e.target.value as ModelProvider
                        setModels([])
                        setModelListError('')
                        setShowModelDropdown(false)
                        setEditingProfile({
                          ...editingProfile,
                          provider,
                          baseURL: provider === 'deepseek' ? DEEPSEEK_API_BASE_URL : '',
                          name: provider === 'google' ? 'Gemini' : provider === 'deepseek' ? 'DeepSeek' : editingProfile.name,
                          model: provider === 'google' ? 'gemini-2.5-flash' : provider === 'deepseek' ? DEEPSEEK_LATEST_MODEL : editingProfile.model,
                          availableModels: undefined,
                        })
                      }}
                    >
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="google">Google Gemini</option>
                    </select>
                  </div>
                  {/* API Base URL — 仅 OpenAI 兼容时显示（DeepSeek/Google 自动填入） */}
                  {editingProfile.provider !== 'deepseek' && (
                    <div className="form-field form-field--full">
                      <label className="form-field__label">API Base URL</label>
                      <input
                        className="form-field__input"
                        type="text"
                        value={editingProfile.baseURL}
                        onChange={(e) => updateField('baseURL', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                  )}
                </>
              )}

              {/* API Key */}
              <div className="form-field form-field--full">
                <label className="form-field__label">
                  API Key
                  {editingProfile.provider === 'google' && (
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                      从 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Google AI Studio</a> 获取
                    </span>
                  )}
                  {editingProfile.provider === 'deepseek' && (
                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                      从 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>DeepSeek 开放平台</a> 获取
                    </span>
                  )}
                </label>
                <input
                  className="form-field__input"
                  type="password"
                  autoComplete="new-password"
                  value={editingProfile.apiKey}
                  onChange={(e) => updateField('apiKey', e.target.value)}
                  placeholder={editingProfile.provider === 'google' ? 'AIzaSy...' : 'sk-...'}
                />
              </div>

              {/* 模型 */}
              <div className="form-field form-field--full">
                <label className="form-field__label">模型</label>
                <div className="model-input-row" ref={modelDropdownRef}>
                  <input
                    className="form-field__input"
                    type="text"
                    value={editingProfile.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    onFocus={() => { if (models.length > 0) setShowModelDropdown(true) }}
                    onClick={() => { if (models.length > 0) setShowModelDropdown(true) }}
                    placeholder={editingProfile.provider === 'google' ? 'gemini-2.5-flash' : editingProfile.provider === 'deepseek' ? DEEPSEEK_LATEST_MODEL : 'gpt-4o'}
                  />
                  <button
                    className="model-fetch-btn"
                    onClick={handleListModels}
                    disabled={modelsLoading || !editingProfile.apiKey}
                  >
                    {modelsLoading ? <Loader2 size={14} className="spin" /> : <List size={14} />}
                    {modelsLoading ? '加载中' : '获取列表'}
                  </button>
                  {showModelDropdown && models.length > 0 && (
                    <div className="model-dropdown">
                      {models.map((m) => (
                        <button key={m} className="model-dropdown__item" onClick={() => selectModel(m)}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {modelListError && (
                  <div className="model-error">{modelListError}</div>
                )}
                {editingProfile.provider === 'deepseek' && (
                  <div className="form-field__hint">
                    deepseek-v4-flash 自动使用当前官方 V4 Flash 版本；旧 deepseek-chat / deepseek-reasoner 已停止服务。
                  </div>
                )}
              </div>
            </div>

            {/* Footer: 测试 + 保存 */}
            <div className="profile-editor__footer">
              <button className="settings-btn" onClick={handleTest} disabled={testStatus === 'testing'}>
                {testStatus === 'testing' && <Loader2 size={14} className="spin" />}
                测试连接
              </button>
              <div className="test-status">
                {testStatus === 'success' && (
                  <span className="test-status--ok"><CheckCircle2 size={14} /> 连接成功</span>
                )}
                {testStatus === 'error' && (
                  <span className="test-status--err"><XCircle size={14} /> {testError}</span>
                )}
              </div>
              <div className="profile-editor__footer-right">
                <button className="settings-btn" onClick={() => setEditingProfile(null)}>取消</button>
                <button className="settings-btn settings-btn--primary" onClick={handleSave} disabled={savingProfile}>
                  {savingProfile && <Loader2 size={14} className="spin" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 提示 */}
        <div className="info-bar info-bar--info" style={{ marginTop: 12 }}>
          <span className="info-bar__icon">💡</span>
          <div className="info-bar__body">
            <div className="info-bar__title">关于模型配置</div>
            <div className="info-bar__message">
              支持 OpenAI 兼容 API（DeepSeek、OpenRouter 等）和 Google Gemini。
              选择激活的配置后，AI 对话将使用该模型。
            </div>
          </div>
        </div>

        {/* 外部链接 */}
        <div style={{ marginTop: 12 }}>
          <div className="settings-group__header">外部链接</div>

          <div
            className="settings-card clickable"
            onClick={() => window.open('https://platform.deepseek.com', '_blank')}
          >
            <div className="settings-card__icon">
              <Sparkles size={18} />
            </div>
            <div className="settings-card__body">
              <div className="settings-card__title">DeepSeek 开放平台</div>
              <div className="settings-card__desc">申请 API Key、查看文档、管理用量</div>
            </div>
            <div className="settings-card__action">
              <ExternalLink size={16} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
