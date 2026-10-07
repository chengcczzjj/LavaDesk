import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StockItem, StockSymbol, WidgetInstance } from '@shared/types'
import { isGeneratedWidgetDefinition } from '@shared/generated-widget'
import { POPULAR_A_SHARE_SYMBOLS } from '@shared/stock-symbols'
import {
  Clock as ClockIcon,
  Calendar,
  Monitor,
  Plus,
  Type,
  Minus,
  CloudSun,
  TrendingUp,
  Newspaper,
  Wrench,
  Cat,
  Music,
  Activity,
  ChevronLeft,
  ChevronRight,
  X,
  CloudRain,
  Sun,
  Disc,
  Settings,
  RefreshCw,
  Archive,
  PanelBottom,
  Trash2,
  Sparkles,
} from 'lucide-react'
import { getStylesForType } from '../../widgets/shared/constants'
import { LavaNotesPanel } from './widgets/LavaNotesPanel'

/* ============================
   组件目录定义 — 严格对齐 demo
   ============================ */

/**
 * 组件尺寸规范（仿 macOS 桌面组件）
 * 基础单元 160px，间距 16px
 *   小 (small)    : 1×1 = 160×160
 *   中-横 (medium) : 2×1 = 336×160
 *   中-竖 (medium-v): 1×2 = 160×336
 *   大 (large)    : 2×2 = 336×336
 */
const UNIT = 160
const GAP = 16
const WIDGET_SIZES = {
  small: { w: UNIT, h: UNIT, css: 'size-1x1' },
  medium: { w: UNIT * 2 + GAP, h: UNIT, css: 'size-2x1' },
  'medium-v': { w: UNIT, h: UNIT * 2 + GAP, css: 'size-1x2' },
  large: { w: UNIT * 2 + GAP, h: UNIT * 2 + GAP, css: 'size-2x2' },
} as const

type WidgetSize = keyof typeof WIDGET_SIZES

interface WidgetCatalogItem {
  type: string
  name: string
  icon: React.ReactNode
  size: WidgetSize
  /** 用于悬浮挂件区（无背景） */
  floating?: true
}

/** 悬浮挂件（无背景卡片） */
const FLOATING_WIDGETS: WidgetCatalogItem[] = [
  { type: 'clock', name: '时间', icon: <ClockIcon size={20} />, size: 'medium', floating: true },
  { type: 'elegantclock', name: '日期时钟', icon: <ClockIcon size={20} />, size: 'medium', floating: true },
  { type: 'pixelclock', name: '像素时钟', icon: <ClockIcon size={20} />, size: 'medium', floating: true },
  { type: 'graphicdatetime', name: '图形时间', icon: <ClockIcon size={20} />, size: 'medium', floating: true },
  { type: 'audio', name: '音频可视化', icon: <Activity size={20} />, size: 'medium', floating: true },
  { type: 'weather', name: '天气', icon: <CloudSun size={20} />, size: 'small', floating: true },
  { type: 'whitenoise', name: '白噪音', icon: <Music size={20} />, size: 'small', floating: true },
  { type: 'text', name: '桌面文字', icon: <Type size={20} />, size: 'medium', floating: true },
]

/** 卡片组件（有背景卡片） */
const CARD_WIDGETS: WidgetCatalogItem[] = [
  { type: 'stocks', name: '自选股', icon: <TrendingUp size={20} />, size: 'large' },
  { type: 'news', name: '新闻', icon: <Newspaper size={20} />, size: 'medium-v' },
  { type: 'calendar', name: '日历', icon: <Calendar size={20} />, size: 'small' },
  { type: 'quicktools', name: '快捷工具', icon: <Wrench size={20} />, size: 'medium' },
  { type: 'pet', name: '桌面萌宠', icon: <Cat size={20} />, size: 'small' },
  { type: 'sysmonitor', name: '系统监控', icon: <Monitor size={20} />, size: 'medium' },
]

/** 图标收纳组件（毛玻璃高透明度，可自由调大小） */
const ICON_WIDGETS: WidgetCatalogItem[] = [
  { type: 'desktop-icons-box', name: '纵向收纳', icon: <Archive size={20} />, size: 'small', floating: true },
  { type: 'desktop-icons-horizontal', name: '横向收纳', icon: <Archive size={20} />, size: 'small', floating: true },
  { type: 'desktop-icons-adaptive', name: '自适应收纳', icon: <Archive size={20} />, size: 'small', floating: true },
  { type: 'desktop-icons-dock', name: '桌面 Dock', icon: <PanelBottom size={20} />, size: 'medium', floating: true },
]

/** 悬浮组件在桌面上的默认尺寸（0 表示 fit-content 自适应） */
const FLOATING_DESKTOP_SIZES: Record<string, { w: number; h: number }> = {
  clock: { w: 0, h: 0 },
  elegantclock: { w: 0, h: 0 },
  pixelclock: { w: 0, h: 0 },
  graphicdatetime: { w: 0, h: 0 },
  audio: { w: 400, h: 160 },
  weather: { w: 0, h: 0 },
  whitenoise: { w: 0, h: 0 },
  text: { w: 0, h: 0 },
  'desktop-icons-box': { w: 246, h: 344 },
  'desktop-icons-horizontal': { w: 356, h: 242 },
  'desktop-icons-adaptive': { w: 246, h: 242 },
  'desktop-icons-dock': { w: 340, h: 88 },
}
const DOCK_BOTTOM_MARGIN = 72

function canAddMultipleWidgetType(type: string): boolean {
  return ['desktop-icons-box', 'desktop-icons-horizontal', 'desktop-icons-adaptive'].includes(type)
}

/** 新闻来源选项 */
const NEWS_SOURCE_OPTIONS = [
  { id: 'toutiao', label: '头条热搜' },
  { id: 'weibo', label: '微博热搜' },
  { id: 'baidu', label: '百度热搜' },
  { id: 'zhihu', label: '知乎热搜' },
  { id: 'bilibili', label: 'B站热搜' },
]

/** 常用股票/指数快捷添加 */
const POPULAR_STOCKS: StockSymbol[] = [...POPULAR_A_SHARE_SYMBOLS]

export function WidgetsPage({ subPage }: { subPage: string }) {
  const [instances, setInstances] = useState<WidgetInstance[]>([])

  // 设置弹窗
  const [settingsDialog, setSettingsDialog] = useState<'news' | 'stocks' | null>(null)

  // 新闻设置状态
  const [newsSource, setNewsSource] = useState('toutiao')
  const [newsMaxItems, setNewsMaxItems] = useState(5)
  const [newsRefresh, setNewsRefresh] = useState(10)

  // 股票设置状态
  const [stockSymbols, setStockSymbols] = useState<StockSymbol[]>([
    { code: '000001', name: '上证指数', market: '1' },
    { code: '600519', name: '贵州茅台', market: '1' },
  ])
  const [stockRefresh, setStockRefresh] = useState(30)

  // 预览数据
  const [newsPreview, setNewsPreview] = useState<{ title: string }[]>([])
  const [stocksPreview, setStocksPreview] = useState<StockItem[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [stocksLoading, setStocksLoading] = useState(false)

  const refresh = useCallback(async () => {
    const list = await window.lingyue.widget.list()
    setInstances(list)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  /** 已添加的组件类型集合 */
  const addedTypes = new Set(instances.map((i) => i.type))
  const typeCounts = instances.reduce<Record<string, number>>((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1
    return counts
  }, {})

  const addToDesktop = async (c: WidgetCatalogItem, config?: Record<string, unknown>) => {
    if (!canAddMultipleWidgetType(c.type) && addedTypes.has(c.type)) return
    const id = `${c.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { w, h } =
      c.floating && FLOATING_DESKTOP_SIZES[c.type] ? FLOATING_DESKTOP_SIZES[c.type] : WIDGET_SIZES[c.size]
    const x = Math.round(window.screen.width / 2 - w / 2)
    const y = c.type === 'desktop-icons-dock' ? Math.max(24, Math.round(window.screen.height - h - DOCK_BOTTOM_MARGIN)) : Math.round(window.screen.height / 3 - h / 2)
    const inst: WidgetInstance = { id, type: c.type, x, y, width: w, height: h, enabled: true, config }
    await window.lingyue.widget.add(inst)
    refresh()
  }

  const removeFromDesktop = async (type: string) => {
    const inst = instances.find((i) => i.type === type)
    if (inst) {
      await window.lingyue.widget.remove(inst.id)
      refresh()
    }
  }

  const removeAllFromDesktop = async (type: string) => {
    const targets = instances.filter((i) => i.type === type)
    for (const inst of targets) {
      await window.lingyue.widget.remove(inst.id)
    }
    refresh()
  }

  const removeInstanceFromDesktop = async (id: string) => {
    await window.lingyue.widget.remove(id)
    refresh()
  }

  const generatedWidgets = instances.filter((instance) => instance.type === 'generated-widget')

  /** 从已有桌面实例加载配置到设置状态 */
  const loadConfigFromInstance = (type: string) => {
    const inst = instances.find((i) => i.type === type)
    if (!inst?.config) return
    if (type === 'news') {
      if (inst.config.source) setNewsSource(inst.config.source as string)
      if (inst.config.maxItems) setNewsMaxItems(inst.config.maxItems as number)
      if (inst.config.refreshInterval) setNewsRefresh(inst.config.refreshInterval as number)
    } else if (type === 'stocks') {
      if (inst.config.symbols) setStockSymbols(inst.config.symbols as StockSymbol[])
      if (inst.config.refreshInterval) setStockRefresh(inst.config.refreshInterval as number)
    }
  }

  /** 确认设置 → 更新已存在的桌面组件 or 暂存，并刷新预览 */
  const applySettings = async (type: string) => {
    const inst = instances.find((i) => i.type === type)
    if (inst) {
      const config =
        type === 'news'
          ? { source: newsSource, maxItems: newsMaxItems, refreshInterval: newsRefresh }
          : { symbols: stockSymbols, refreshInterval: stockRefresh }
      await window.lingyue.widget.updateConfig(inst.id, config)
      refresh()
    }
    setSettingsDialog(null)
    // 刷新预览数据以同步设置界面
    if (type === 'news') refreshNewsPreview()
    else refreshStocksPreview()
  }

  /** 拉取新闻预览数据 */
  const refreshNewsPreview = useCallback(async () => {
    setNewsLoading(true)
    try {
      const data = await window.lingyue.data.fetchNews(newsSource, newsMaxItems)
      setNewsPreview(data)
    } catch {
      /* ignore */
    }
    setNewsLoading(false)
  }, [newsMaxItems, newsSource])

  /** 拉取股票预览数据 */
  const refreshStocksPreview = useCallback(async () => {
    setStocksLoading(true)
    try {
      const data = await window.lingyue.data.fetchStocks(stockSymbols)
      setStocksPreview(data)
    } catch {
      /* ignore */
    }
    setStocksLoading(false)
  }, [stockSymbols])

  // 初始加载预览数据
  useEffect(() => {
    void refreshNewsPreview()
  }, [refreshNewsPreview])
  useEffect(() => {
    void refreshStocksPreview()
  }, [refreshStocksPreview])

  return (
    <div className="widgets-page">
      <div className="widgets-main">
        {subPage === 'widgets-tasks' && <LavaNotesPanel />}
        {subPage === 'widgets-floating' && (
          <>
            <div className="nobg-grid">
              {FLOATING_WIDGETS.map((fw) => (
                <FloatingWidgetPreview
                  key={fw.type}
                  catalog={fw}
                  added={addedTypes.has(fw.type)}
                  onAdd={(config) => addToDesktop(fw, config)}
                  onRemove={() => removeFromDesktop(fw.type)}
                />
              ))}
            </div>
            <section style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Sparkles size={17} />
                <strong style={{ fontSize: 14 }}>AI 生成的小组件</strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  在聊天中描述清单、倒计时、指标卡或组合信息即可直接生成
                </span>
              </div>
              {generatedWidgets.length === 0 ? (
                <div
                  style={{
                    padding: '20px 22px',
                    border: '1px dashed var(--border-card)',
                    borderRadius: 16,
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                  }}
                >
                  还没有 AI 小组件。试着在聊天里说“帮我做一个 30 天阅读计划组件并放到桌面”。
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                  {generatedWidgets.map((instance) => {
                    const definition = isGeneratedWidgetDefinition(instance.config?.definition)
                      ? instance.config.definition
                      : undefined
                    return (
                      <div
                        key={instance.id}
                        style={{
                          minWidth: 0,
                          padding: 16,
                          border: '1px solid var(--border-card)',
                          borderRadius: 16,
                          background: 'rgba(255,255,255,0.42)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {definition?.title || 'AI 小组件'}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                            {definition?.theme || 'glass'} · {definition?.blocks?.length ?? 0} 个内容块 · {instance.width}×{instance.height}
                          </div>
                        </div>
                        <button
                          type="button"
                          title="从桌面移除"
                          onClick={() => removeInstanceFromDesktop(instance.id)}
                          style={iconManagerRemoveButtonStyle}
                        >
                          <Trash2 size={12} />
                          <span>移除</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {subPage === 'widgets-card' && (
          <>
            <div className="component-grid">
              {/* 自选股 large 2×2 — 宽敞双列布局，最多显示6只 */}
              <div className={`comp-card ${WIDGET_SIZES.large.css} comp-card--bordered`}>
                <div className="comp-content" style={{ padding: 16, overflow: 'hidden', flexDirection: 'column' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 12,
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#0f7b0f',
                    }}
                  >
                    <TrendingUp size={16} /> 自选股
                  </div>
                  {stocksLoading && stocksPreview.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#999' }}>加载中…</div>
                  ) : stocksPreview.length > 0 ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '10px 16px',
                        flex: 1,
                        overflow: 'hidden',
                      }}
                    >
                      {stocksPreview.slice(0, 6).map((stock) => (
                        <div
                          key={stock.code}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'rgba(0,0,0,0.03)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {stock.name}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                            {stock.price == null ? '--' : stock.price.toLocaleString('zh-CN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: (stock.changePercent ?? 0) > 0 ? '#c42b1c' : (stock.changePercent ?? 0) < 0 ? '#0f7b0f' : '#666',
                            }}
                          >
                            {(stock.changePercent ?? 0) > 0 ? '+' : ''}
                            {stock.changePercent == null ? '--' : stock.changePercent.toFixed(2)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#999' }}>暂无数据</div>
                  )}
                </div>
                <CardAction
                  added={addedTypes.has('stocks')}
                  hasSettings
                  onAdd={() => addToDesktop(CARD_WIDGETS[0], { symbols: stockSymbols, refreshInterval: stockRefresh })}
                  onRemove={() => removeFromDesktop('stocks')}
                  onSettings={() => {
                    loadConfigFromInstance('stocks')
                    setSettingsDialog('stocks')
                  }}
                  onRefresh={refreshStocksPreview}
                />
              </div>

              {/* 新闻 medium-v 1×2 */}
              <div className={`comp-card ${WIDGET_SIZES['medium-v'].css} comp-card--bordered`}>
                <div className="comp-content" style={{ flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                  {/* 头条区域 — 占 55% */}
                  <div
                    style={{
                      flex: '0 0 55%',
                      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'flex-end',
                      overflow: 'hidden',
                    }}
                  >
                    {/* 装饰性背景图案 */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0.12,
                        backgroundImage:
                          'radial-gradient(circle at 20% 80%, #e94560 0%, transparent 50%), ' +
                          'radial-gradient(circle at 80% 20%, #0f3460 0%, transparent 50%), ' +
                          'radial-gradient(circle at 60% 60%, #533483 0%, transparent 40%)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: -30,
                        right: -20,
                        width: 100,
                        height: 100,
                        borderRadius: '50%',
                        background: 'rgba(233,69,96,0.15)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 30,
                        left: -15,
                        width: 60,
                        height: 60,
                        borderRadius: '50%',
                        background: 'rgba(83,52,131,0.2)',
                      }}
                    />
                    {/* 顶部标签 */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 10,
                        fontSize: 9,
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.7)',
                        background: 'rgba(255,255,255,0.12)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {NEWS_SOURCE_OPTIONS.find((s) => s.id === newsSource)?.label || '热搜头条'}
                    </div>
                    {/* 头条文字 */}
                    <div
                      style={{
                        width: '100%',
                        padding: '14px 10px 10px',
                        background: 'linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
                        color: '#fff',
                      }}
                    >
                      {newsLoading && newsPreview.length === 0 ? (
                        <div style={{ fontSize: 11, opacity: 0.7 }}>加载中…</div>
                      ) : newsPreview[0] ? (
                        <>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 12,
                              lineHeight: 1.5,
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              textShadow: '0 1px 3px rgba(0,0,0,0.4)',
                            }}
                          >
                            {newsPreview[0].title}
                          </div>
                          {(newsPreview[0] as any).hot && (
                            <div style={{ fontSize: 9, opacity: 0.7, marginTop: 3 }}>
                              🔥 {(newsPreview[0] as any).hot}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 11, opacity: 0.7 }}>暂无数据</div>
                      )}
                    </div>
                  </div>
                  {/* 热搜列表 — 占 45%，最多5条 */}
                  <div
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    {newsPreview.slice(1, 6).map((item, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          lineHeight: 1.3,
                          padding: '3px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: '#1a1a1a',
                          borderBottom: i < Math.min(newsPreview.length - 2, 4) ? '1px solid rgba(0,0,0,0.04)' : 'none',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: 14,
                            textAlign: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            marginRight: 3,
                            color: i < 3 ? '#e94560' : '#aaa',
                          }}
                        >
                          {i + 2}
                        </span>
                        {item.title}
                      </div>
                    ))}
                    {newsPreview.length <= 1 && !newsLoading && (
                      <div style={{ fontSize: 11, color: '#999', textAlign: 'center' }}>暂无数据</div>
                    )}
                  </div>
                </div>
                <CardAction
                  added={addedTypes.has('news')}
                  hasSettings
                  onAdd={() =>
                    addToDesktop(CARD_WIDGETS[1], {
                      source: newsSource,
                      maxItems: newsMaxItems,
                      refreshInterval: newsRefresh,
                    })
                  }
                  onRemove={() => removeFromDesktop('news')}
                  onSettings={() => {
                    loadConfigFromInstance('news')
                    setSettingsDialog('news')
                  }}
                  onRefresh={refreshNewsPreview}
                />
              </div>

              {/* 日历 small 1×1 */}
              <div className={`comp-card ${WIDGET_SIZES.small.css} comp-card--bordered`}>
                <div className="comp-content" style={{ padding: 16, alignItems: 'center', justifyContent: 'center' }}>
                  <CalendarPreview />
                </div>
                <CardAction
                  added={addedTypes.has('calendar')}
                  onAdd={() => addToDesktop(CARD_WIDGETS[2])}
                  onRemove={() => removeFromDesktop('calendar')}
                />
              </div>

              {/* 快捷工具 medium 2×1 */}
              <div className={`comp-card ${WIDGET_SIZES.medium.css} comp-card--bordered`}>
                <div
                  className="comp-content"
                  style={{ padding: 20, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}
                >
                  <ToolIcon label="便签" />
                  <ToolIcon label="截图" />
                  <ToolIcon label="设置" />
                  <ToolIcon label="重启" />
                </div>
                <CardAction
                  added={addedTypes.has('quicktools')}
                  onAdd={() => addToDesktop(CARD_WIDGETS[3])}
                  onRemove={() => removeFromDesktop('quicktools')}
                />
              </div>

              {/* 桌面萌宠 small 1×1 */}
              <div
                className={`comp-card ${WIDGET_SIZES.small.css}`}
                style={{ background: '#FDF9F3', border: '1px solid var(--border-card)' }}
              >
                <div className="comp-content" style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Cat size={48} color="#5C4B3E" style={{ marginBottom: 10 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#5C4B3E' }}>桌面萌宠</div>
                </div>
                <CardAction
                  added={addedTypes.has('pet')}
                  onAdd={() => addToDesktop(CARD_WIDGETS[4])}
                  onRemove={() => removeFromDesktop('pet')}
                />
              </div>

              {/* 系统监控 medium 2×1 */}
              <div className={`comp-card ${WIDGET_SIZES.medium.css} comp-card--bordered`}>
                <div className="comp-content" style={{ padding: 20, justifyContent: 'center' }}>
                  <SysMonitorPreview />
                </div>
                <CardAction
                  added={addedTypes.has('sysmonitor')}
                  onAdd={() => addToDesktop(CARD_WIDGETS[5])}
                  onRemove={() => removeFromDesktop('sysmonitor')}
                />
              </div>
            </div>
          </>
        )}

        {subPage === 'widgets-icons' && (
          <>
            <div className="icon-manager-grid">
              {ICON_WIDGETS.map((item) => (
                <IconManagerPreview
                  key={item.type}
                  catalog={item}
                  count={typeCounts[item.type] ?? 0}
                  canAddMore={canAddMultipleWidgetType(item.type) || !addedTypes.has(item.type)}
                  onAdd={() => addToDesktop(item, { items: [] })}
                  onRemoveAll={() => removeAllFromDesktop(item.type)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ===== 设置弹窗 ===== */}
      {settingsDialog && (
        <WidgetSettingsDialog
          type={settingsDialog}
          newsSource={newsSource}
          newsMaxItems={newsMaxItems}
          newsRefresh={newsRefresh}
          stockSymbols={stockSymbols}
          stockRefresh={stockRefresh}
          onNewsSourceChange={setNewsSource}
          onNewsMaxItemsChange={setNewsMaxItems}
          onNewsRefreshChange={setNewsRefresh}
          onStockSymbolsChange={setStockSymbols}
          onStockRefreshChange={setStockRefresh}
          onConfirm={() => applySettings(settingsDialog)}
          onClose={() => setSettingsDialog(null)}
        />
      )}
    </div>
  )
}

function IconManagerPreview({
  catalog,
  count,
  canAddMore,
  onAdd,
  onRemoveAll,
}: {
  catalog: WidgetCatalogItem
  count: number
  canAddMore: boolean
  onAdd: () => void
  onRemoveAll: () => void
}) {
  const preview = getIconPreviewSpec(catalog.type)
  const multi = canAddMultipleWidgetType(catalog.type)
  return (
    <div className="comp-card comp-card--nobg icon-manager-card" style={{ width: 196, height: 210 }}>
      <div className="comp-content" style={{ position: 'relative', overflow: 'hidden', padding: 12, gap: 8, alignItems: 'center' }}>
        <div style={iconManagerStageStyle}>
          {catalog.type === 'desktop-icons-dock' ? <IconDockPreview /> : <IconBoxPreview variant={catalog.type} />}
        </div>
        <span style={{ ...iconManagerAccentStyle, background: preview.accent }} />
        <div style={iconManagerNameRowStyle}>
          <span style={iconManagerNameStyle}>{catalog.name}</span>
          {count > 0 && <span style={iconManagerCountStyle}>{count}</span>}
        </div>
        {count > 0 && (
          <button
            type="button"
            title={multi ? '全部删除' : '删除'}
            onClick={(event) => {
              event.stopPropagation()
              const prompt = multi
                ? `删除全部 ${count} 个“${catalog.name}”？收纳的桌面图标会尽量移回桌面。`
                : `删除“${catalog.name}”？收纳的桌面图标会尽量移回桌面。`
              if (window.confirm(prompt)) onRemoveAll()
            }}
            style={iconManagerRemoveButtonStyle}
          >
            <Trash2 size={12} />
            <span>{multi ? '全部删除' : '删除'}</span>
          </button>
        )}
      </div>
      {canAddMore && (
        <div className="comp-hover-actions">
          <button
            className="comp-hover-btn btn-add"
            title="添加到桌面"
            onClick={(event) => {
              event.stopPropagation()
              onAdd()
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

interface IconPreviewSpec {
  columns: number
  rows: number
  iconSize: number
  gap: number
  surfaceWidth: number
  surfaceHeight: number
  count: number
  accent: string
}

const ICON_PREVIEW_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee']

const ICON_PREVIEW_SPECS: Record<string, IconPreviewSpec> = {
  'desktop-icons-box': {
    columns: 2,
    rows: 3,
    iconSize: 20,
    gap: 6,
    surfaceWidth: 90,
    surfaceHeight: 118,
    count: 6,
    accent: '#38bdf8',
  },
  'desktop-icons-horizontal': {
    columns: 3,
    rows: 2,
    iconSize: 20,
    gap: 8,
    surfaceWidth: 126,
    surfaceHeight: 94,
    count: 6,
    accent: '#34d399',
  },
  'desktop-icons-adaptive': {
    columns: 2,
    rows: 2,
    iconSize: 24,
    gap: 9,
    surfaceWidth: 104,
    surfaceHeight: 104,
    count: 4,
    accent: '#f59e0b',
  },
}

const iconManagerNameRowStyle: CSSProperties = {
  width: '100%',
  minHeight: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minWidth: 0,
}

const iconManagerNameStyle: CSSProperties = {
  minWidth: 0,
  color: 'var(--text-primary)',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: '20px',
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const iconManagerCountStyle: CSSProperties = {
  minWidth: 18,
  height: 18,
  padding: '0 6px',
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15,23,42,0.12)',
  color: 'var(--text-primary)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: '18px',
}

const iconManagerStageStyle: CSSProperties = {
  width: '100%',
  height: 120,
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const iconManagerAccentStyle: CSSProperties = {
  width: 28,
  height: 3,
  flex: '0 0 auto',
  borderRadius: 999,
  opacity: 0.72,
}

const iconManagerRemoveButtonStyle: CSSProperties = {
  height: 24,
  padding: '0 10px',
  border: '1px solid rgba(239,68,68,0.22)',
  borderRadius: 999,
  background: 'rgba(239,68,68,0.1)',
  color: 'rgba(185,28,28,0.9)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
}

function IconBoxPreview({ variant }: { variant: string }) {
  const spec = getIconPreviewSpec(variant)
  return (
    <div
      style={{
        width: spec.surfaceWidth,
        height: spec.surfaceHeight,
        boxSizing: 'border-box',
        position: 'relative',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.52)',
        background: 'linear-gradient(145deg, rgba(255,255,255,0.48), rgba(255,255,255,0.16))',
        boxShadow: '0 14px 28px rgba(15,23,42,0.13), inset 0 1px 0 rgba(255,255,255,0.58)',
        display: 'grid',
        gridTemplateColumns: `repeat(${spec.columns}, ${spec.iconSize}px)`,
        gridTemplateRows: `repeat(${spec.rows}, ${spec.iconSize + 7}px)`,
        alignContent: 'center',
        justifyItems: 'center',
        justifyContent: 'center',
        gap: spec.gap,
        padding: 8,
      }}
    >
      {Array.from({ length: spec.count }).map((_, index) => {
        const color = ICON_PREVIEW_COLORS[index % ICON_PREVIEW_COLORS.length]
        return (
          <div key={`${variant}-${index}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: spec.iconSize,
                height: spec.iconSize,
                borderRadius: Math.max(6, spec.iconSize * 0.32),
                background: `linear-gradient(145deg, ${color}, rgba(255,255,255,0.82))`,
                boxShadow: '0 6px 12px rgba(15,23,42,0.16)',
              }}
            />
            <div style={{ width: spec.iconSize, height: 3, borderRadius: 4, background: 'rgba(15,23,42,0.14)' }} />
          </div>
        )
      })}
      {variant === 'desktop-icons-box' && <div style={verticalPreviewHintStyle} />}
      {variant === 'desktop-icons-horizontal' && <div style={horizontalPreviewHintStyle} />}
    </div>
  )
}

function getIconPreviewSpec(type: string): IconPreviewSpec {
  return (
    ICON_PREVIEW_SPECS[type] ?? {
      columns: 4,
      rows: 1,
      iconSize: 20,
      gap: 8,
      surfaceWidth: 126,
      surfaceHeight: 54,
      count: 4,
      accent: '#818cf8',
    }
  )
}

const verticalPreviewHintStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  top: 18,
  width: 3,
  height: 82,
  borderRadius: 999,
  background: 'linear-gradient(180deg, rgba(56,189,248,0.12), rgba(56,189,248,0.58), rgba(56,189,248,0.12))',
}

const horizontalPreviewHintStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 6,
  height: 3,
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(52,211,153,0.12), rgba(52,211,153,0.58), rgba(52,211,153,0.12))',
}

function IconDockPreview() {
  return (
    <div
      style={{
        width: 126,
        height: 68,
        boxSizing: 'border-box',
        borderRadius: 18,
        border: '1px solid rgba(255,255,255,0.52)',
        background: 'linear-gradient(145deg, rgba(255,255,255,0.46), rgba(255,255,255,0.16))',
        boxShadow: '0 14px 28px rgba(15,23,42,0.13), inset 0 1px 0 rgba(255,255,255,0.58)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 7,
        padding: '0 12px 9px',
      }}
    >
      {[24, 32, 42, 32, 24].map((size, index) => (
        <div
          key={`${size}-${index}`}
          style={{
            width: size,
            height: size,
            borderRadius: Math.max(7, size * 0.26),
            background: `linear-gradient(145deg, hsl(${196 + index * 34} 80% 62%), rgba(255,255,255,0.82))`,
            boxShadow: '0 8px 15px rgba(15,23,42,0.17)',
          }}
        />
      ))}
    </div>
  )
}

/* ===== 卡片操作按钮（添加/删除/设置/刷新） ===== */
function CardAction({
  added,
  hasSettings,
  onAdd,
  onRemove,
  onSettings,
  onRefresh,
}: {
  added: boolean
  onAdd: () => void
  onRemove: () => void
  hasSettings?: boolean
  onSettings?: () => void
  onRefresh?: () => void
}) {
  return (
    <>
      {added ? (
        <button className="comp-delete-btn" title="从桌面移除" onClick={onRemove}>
          <Minus size={12} />
        </button>
      ) : (
        <div className="comp-hover-actions">
          <button className="comp-hover-btn btn-add" title="添加到桌面" onClick={onAdd}>
            <Plus size={12} />
          </button>
        </div>
      )}
      {/* 设置+刷新按钮组 */}
      {hasSettings && (
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            zIndex: 15,
            display: 'flex',
            gap: 4,
          }}
        >
          {onRefresh && (
            <button
              title="刷新数据"
              onClick={onRefresh}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.06)',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              <RefreshCw size={11} />
            </button>
          )}
          <button
            title="设置"
            onClick={onSettings}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.06)',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            <Settings size={12} />
          </button>
        </div>
      )}
    </>
  )
}

/* ===== 设置弹窗 ===== */
function WidgetSettingsDialog({
  type,
  newsSource,
  newsMaxItems,
  newsRefresh,
  stockSymbols,
  stockRefresh,
  onNewsSourceChange,
  onNewsMaxItemsChange,
  onNewsRefreshChange,
  onStockSymbolsChange,
  onStockRefreshChange,
  onConfirm,
  onClose,
}: {
  type: 'news' | 'stocks'
  newsSource: string
  newsMaxItems: number
  newsRefresh: number
  stockSymbols: StockSymbol[]
  stockRefresh: number
  onNewsSourceChange: (v: string) => void
  onNewsMaxItemsChange: (v: number) => void
  onNewsRefreshChange: (v: number) => void
  onStockSymbolsChange: (v: StockSymbol[]) => void
  onStockRefreshChange: (v: number) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }
  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-control)',
    background: '#fff',
    fontSize: 13,
    color: 'var(--text-primary)',
    outline: 'none',
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 420,
          maxHeight: '80vh',
          borderRadius: 12,
          background: 'var(--bg-solid)',
          boxShadow: 'var(--shadow-flyout)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-divider)',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>{type === 'news' ? '新闻设置' : '自选股设置'}</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          {type === 'news' ? (
            <>
              <div>
                <div style={labelStyle}>数据来源</div>
                <select value={newsSource} onChange={(e) => onNewsSourceChange(e.target.value)} style={selectStyle}>
                  {NEWS_SOURCE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={labelStyle}>显示条数</div>
                <select
                  value={newsMaxItems}
                  onChange={(e) => onNewsMaxItemsChange(Number(e.target.value))}
                  style={selectStyle}
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} 条
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={labelStyle}>自动刷新间隔</div>
                <select
                  value={newsRefresh}
                  onChange={(e) => onNewsRefreshChange(Number(e.target.value))}
                  style={selectStyle}
                >
                  {[5, 10, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} 分钟
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                数据来源：codelife.cc / weibo.com · 免费无需密钥 · 不包含图片
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={labelStyle}>当前自选 ({stockSymbols.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stockSymbols.map((s) => (
                    <div
                      key={s.code}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(0,0,0,0.03)',
                        fontSize: 13,
                      }}
                    >
                      <span>
                        {s.name} <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{s.code}</span>
                      </span>
                      <button
                        onClick={() => onStockSymbolsChange(stockSymbols.filter((x) => x.code !== s.code))}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-tertiary)',
                          padding: 2,
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={labelStyle}>快速添加</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {POPULAR_STOCKS.filter((p) => !stockSymbols.some((s) => s.code === p.code)).map((s) => (
                    <button
                      key={s.code}
                      onClick={() => onStockSymbolsChange([...stockSymbols, s])}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-control)',
                        background: '#fff',
                        fontSize: 12,
                        cursor: 'pointer',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      + {s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={labelStyle}>自动刷新间隔</div>
                <select
                  value={stockRefresh}
                  onChange={(e) => onStockRefreshChange(Number(e.target.value))}
                  style={selectStyle}
                >
                  {[10, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                数据来源：东方财富 push2 API · 免费无需密钥 · 建议 ≥10 秒/次
              </div>
            </>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '12px 20px',
            borderTop: '1px solid var(--border-divider)',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '6px 20px',
              borderRadius: 6,
              border: '1px solid var(--border-control)',
              background: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--text-primary)',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

/* ===== 悬浮组件预览（纯 inline style 深色静态预览） ===== */
function FloatingWidgetPreview({
  catalog,
  added,
  onAdd,
  onRemove,
}: {
  catalog: WidgetCatalogItem
  added: boolean
  onAdd: (config?: Record<string, unknown>) => void
  onRemove: () => void
}) {
  const styles = getStylesForType(catalog.type)
  const [styleIndex, setStyleIndex] = useState(0)
  const hasStyles = styles.length > 1

  const currentStyle = styles[styleIndex]
  const config = getFloatingDefaultConfig(catalog.type, currentStyle?.id)

  const prev = () => setStyleIndex((i) => (i - 1 + styles.length) % styles.length)
  const next = () => setStyleIndex((i) => (i + 1) % styles.length)

  const { w, h } = WIDGET_SIZES[catalog.size]

  return (
    <div className="comp-card comp-card--nobg" style={{ width: w, height: h }}>
      <div className="comp-content" style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderFloatingPreview(catalog.type, currentStyle?.id)}
        </div>
      </div>
      {/* 样式切换箭头 + 添加按钮（仅 hover 可见） */}
      <div className="comp-hover-actions">
        {hasStyles && (
          <>
            <button className="comp-hover-btn btn-prev" title="上一个样式" onClick={prev}>
              <ChevronLeft size={16} />
            </button>
            <button className="comp-hover-btn btn-next" title="下一个样式" onClick={next}>
              <ChevronRight size={16} />
            </button>
          </>
        )}
        {!added && (
          <button className="comp-hover-btn btn-add" title="添加到桌面" onClick={() => onAdd(config)}>
            <Plus size={12} />
          </button>
        )}
      </div>
      {/* 删除按钮（已添加时始终可见） */}
      {added && (
        <button className="comp-delete-btn" title="从桌面移除" onClick={onRemove}>
          <Minus size={12} />
        </button>
      )}
    </div>
  )
}

/** 悬浮组件静态深色预览（纯 inline style，不依赖 Tailwind） */
function renderFloatingPreview(type: string, styleId?: string) {
  switch (type) {
    case 'clock':
      return <ClockPreview styleId={styleId} />
    case 'elegantclock':
      return <ElegantClockPreview />
    case 'pixelclock':
      return <PixelClockPreview styleId={styleId} />
    case 'graphicdatetime':
      return <GraphicDateTimePreview />
    case 'audio':
      return <AudioPreview styleId={styleId} />
    case 'weather':
      return <WeatherPreview styleId={styleId} />
    case 'whitenoise':
      return <WhiteNoisePreview styleId={styleId} />
    case 'text':
      return <TextPreview />
    default:
      return null
  }
}

function getFloatingDefaultConfig(type: string, styleId?: string): Record<string, unknown> {
  const styleConfig = styleId ? { style: styleId } : {}
  if (type === 'graphicdatetime') return { ...styleConfig, themeId: 'yellow', darkMode: true }
  return styleConfig
}

/* ===== 悬浮组件静态预览（按样式切换） ===== */

function ClockPreview({ styleId }: { styleId?: string }) {
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const hours = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit' })
  const minutes = now.toLocaleTimeString('en-US', { minute: '2-digit' })
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()

  const base: React.CSSProperties = { textAlign: 'center', color: '#1a1a1a' }

  if (styleId === 'stacked') {
    return (
      <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.05 }}>
        <span style={{ fontSize: 48, fontWeight: 900, letterSpacing: -2, opacity: 0.9 }}>{hours}</span>
        <span style={{ fontSize: 48, fontWeight: 900, letterSpacing: -2, opacity: 0.9 }}>{minutes}</span>
        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 4, marginTop: 4, opacity: 0.7 }}>{day}</span>
      </div>
    )
  }
  // minimal (default)
  return (
    <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>{time}</span>
      <span style={{ fontSize: 13, fontWeight: 300, letterSpacing: 5, opacity: 0.7, marginTop: 4 }}>
        {day} · {date}
      </span>
    </div>
  )
}

function AudioPreview({ styleId }: { styleId?: string }) {
  const bars = [0.3, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 0.5, 0.3, 0.6, 0.8, 0.4]

  if (styleId === 'wave') {
    // 波形线
    const points = bars.map((v, i) => `${i * 24},${60 - v * 50}`).join(' ')
    return (
      <svg width="280" height="60" viewBox="0 0 280 60" style={{ overflow: 'visible' }}>
        <polyline
          points={points}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />
      </svg>
    )
  }
  if (styleId === 'spectrum') {
    // 平滑曲线填充
    const pts = bars.map((v, i) => ({ x: i * 24, y: 60 - v * 50 }))
    const d =
      `M ${pts[0].x} ${pts[0].y} ` +
      pts
        .slice(1)
        .map((p) => `L ${p.x} ${p.y}`)
        .join(' ') +
      ` L ${pts[pts.length - 1].x} 60 L 0 60 Z`
    return (
      <svg width="280" height="60" viewBox="0 0 280 60">
        <path d={d} fill="rgba(26,26,26,0.15)" stroke="#1a1a1a" strokeWidth="2" opacity="0.7" />
      </svg>
    )
  }
  if (styleId === 'dna') {
    // 对称镜像条
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 80 }}>
        {bars.map((v, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ width: 5, height: v * 35, borderRadius: 2.5, background: '#1a1a1a', opacity: 0.7 }} />
            <div style={{ width: 5, height: v * 35, borderRadius: 2.5, background: '#1a1a1a', opacity: 0.4 }} />
          </div>
        ))}
      </div>
    )
  }
  // bars (default)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: h * 60,
            borderRadius: 3,
            background: 'linear-gradient(to top, #1a1a1a, #555)',
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  )
}

function WeatherPreview({ styleId }: { styleId?: string }) {
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, color: '#1a1a1a' }

  if (styleId === 'realism') {
    return (
      <div style={row}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            opacity: 0.8,
            flexShrink: 0,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>22°</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>Beijing · Sunny</span>
        </div>
      </div>
    )
  }
  if (styleId === 'glass') {
    return (
      <div
        style={{
          ...row,
          padding: '10px 16px',
          borderRadius: 14,
          background: 'rgba(0,0,0,0.05)',
          border: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <Sun size={28} style={{ opacity: 0.7, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>22°</span>
          <span style={{ fontSize: 9, opacity: 0.5 }}>Beijing</span>
        </div>
      </div>
    )
  }
  if (styleId === 'neon') {
    return (
      <div style={row}>
        <Sun size={32} style={{ opacity: 0.9, filter: 'drop-shadow(0 0 6px rgba(26,26,26,0.3))', flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, lineHeight: 1.1 }}>22°</span>
          <span style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>Beijing</span>
        </div>
      </div>
    )
  }
  // minimal (default)
  return (
    <div style={row}>
      <Sun size={32} style={{ opacity: 0.8, flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>22°</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>Beijing · 晴</span>
      </div>
    </div>
  )
}

function WhiteNoisePreview({ styleId }: { styleId?: string }) {
  const circleOuter: React.CSSProperties = {
    width: 56,
    height: 56,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
  const circleInner: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  if (styleId === 'cd') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            ...circleOuter,
            background: 'conic-gradient(from 0deg, #888, #ccc, #888, #aaa, #888)',
            border: '3px solid rgba(0,0,0,0.1)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
          }}
        >
          <div style={{ ...circleInner, background: 'linear-gradient(135deg, #444, #222)' }}>
            <Disc size={16} color="#999" />
          </div>
        </div>
      </div>
    )
  }
  if (styleId === 'minimal') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            ...circleOuter,
            background: '#f5f5f5',
            border: '2px solid rgba(0,0,0,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ ...circleInner, background: '#e8e8e8' }}>
            <CloudRain size={16} color="#333" />
          </div>
        </div>
      </div>
    )
  }
  // glass (default)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          ...circleOuter,
          background: 'linear-gradient(135deg, rgba(0,0,0,0.08), rgba(0,0,0,0.15))',
          border: '3px solid rgba(0,0,0,0.1)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}
      >
        <div
          style={{
            ...circleInner,
            background: 'linear-gradient(135deg, rgba(0,0,0,0.05), rgba(0,0,0,0.12))',
            border: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <CloudRain size={16} color="#555" />
        </div>
      </div>
    </div>
  )
}

function ElegantClockPreview() {
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  const base: React.CSSProperties = { textAlign: 'center', color: '#1a1a1a' }

  return (
    <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: 3 }}>{day}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ height: 1, width: 36, background: '#1a1a1a', opacity: 0.3 }} />
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 4 }}>{time}</span>
        <div style={{ height: 1, width: 36, background: '#1a1a1a', opacity: 0.3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 5, opacity: 0.6 }}>{date}</span>
    </div>
  )
}

const PIXEL_FONT_PREVIEW = "'Press Start 2P', 'Courier New', monospace"

function PixelClockPreview({ styleId }: { styleId?: string }) {
  const now = new Date()
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  const base: React.CSSProperties = { textAlign: 'center', color: '#1a1a1a', fontFamily: PIXEL_FONT_PREVIEW }

  if (styleId === 'weekday') {
    return (
      <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 8 }}>{day}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ height: 1, width: 30, background: '#1a1a1a', opacity: 0.3 }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 4 }}>{time}</span>
          <div style={{ height: 1, width: 30, background: '#1a1a1a', opacity: 0.3 }} />
        </div>
        <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 5, opacity: 0.6 }}>{date}</span>
      </div>
    )
  }
  // minimal (default)
  return (
    <div style={{ ...base, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>{time}</span>
      <span style={{ fontSize: 9, fontWeight: 300, letterSpacing: 5, opacity: 0.7, marginTop: 8 }}>
        {day} · {date}
      </span>
    </div>
  )
}

function GraphicDateTimePreview() {
  const now = new Date()
  const day = now.toLocaleDateString('en-US', { day: '2-digit' })
  const month = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase().split('')
  const monthFontSize = month.length >= 9 ? 16 : month.length >= 8 ? 18 : 21
  const weekdayFontSize = weekday.length > 7 ? 5 : 6
  const weekdayGap = weekday.length > 7 ? 2 : 3
  const weekdayTop = weekday.length > 7 ? 74 : 84
  const textColor = '#29272f'
  const dateGradient =
    'linear-gradient(180deg, rgba(250, 204, 21, 0.98) 0%, rgba(250, 204, 21, 0.82) 52%, rgba(250, 204, 21, 0.38) 100%)'
  const dateNumberFont =
    "'Bahnschrift Condensed', 'Aptos Narrow', 'Arial Narrow', 'Roboto Condensed', 'HelveticaNeue-CondensedBold', sans-serif"

  return (
    <div
      style={{
        position: 'relative',
        width: 156,
        height: 156,
        fontFamily: "'Bahnschrift Condensed', 'Aptos Narrow', 'Arial Narrow', 'Helvetica Neue', 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '4px 4px 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
        }}
      >
        {day.split('').map((digit, index) => (
          <span
            key={`${digit}-${index}`}
            style={{
              width: 60,
              fontFamily: dateNumberFont,
              fontSize: 132,
              lineHeight: 0.95,
              fontWeight: 800,
              letterSpacing: 0,
              textAlign: 'center',
              overflow: 'visible',
              backgroundImage: dateGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {digit}
          </span>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 36,
          top: weekdayTop,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: weekdayGap,
          color: textColor,
        }}
      >
        {weekday.map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            style={{ fontSize: weekdayFontSize, lineHeight: 1, fontWeight: 900, letterSpacing: 0 }}
          >
            {letter}
          </span>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 54, top: 60, width: 92, color: textColor }}>
        <div
          style={{ fontSize: monthFontSize, lineHeight: 0.92, fontWeight: 950, letterSpacing: 0, whiteSpace: 'nowrap' }}
        >
          {month}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 7,
            lineHeight: 1,
            fontWeight: 850,
            letterSpacing: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {time}
        </div>
        <div style={{ width: 42, height: 1, marginTop: 7, background: 'rgba(41,39,47,0.58)' }} />
        <div style={{ width: 96, marginTop: 14, fontSize: 5, lineHeight: 1.34, fontWeight: 700, letterSpacing: 0 }}>
          Weather in Beijing
          <br />
          Clear, 14° · Humidity 71%
          <br />
          Wind 9 km/h
        </div>
      </div>
    </div>
  )
}

function TextPreview() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        textAlign: 'center',
        width: '100%',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, opacity: 0.85 }}>
        "Stay Hungry, Stay Foolish."
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>— Steve Jobs</div>
    </div>
  )
}

/* ===== 预览子组件 ===== */

function CalendarPreview() {
  const now = new Date()
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#c42b1c', marginBottom: 8 }}>
        {now.toLocaleDateString('zh-CN', { weekday: 'long' })}
      </div>
      <div style={{ fontSize: 48, fontWeight: 'bold', lineHeight: 1, marginBottom: 8 }}>{now.getDate()}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
      </div>
    </>
  )
}

function SysMonitorPreview() {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
        <span>CPU Util</span>
        <span>34%</span>
      </div>
      <div
        style={{
          width: '100%',
          height: 8,
          borderRadius: 4,
          background: 'var(--border-control)',
          marginBottom: 16,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: '34%', height: '100%', background: 'var(--accent)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
        <span>Memory</span>
        <span>12.4 GB / 32.0 GB</span>
      </div>
      <div
        style={{ width: '100%', height: 8, borderRadius: 4, background: 'var(--border-control)', overflow: 'hidden' }}
      >
        <div style={{ width: '40%', height: '100%', background: '#f0a030' }} />
      </div>
    </>
  )
}

function ToolIcon({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--bg-solid)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 6,
          border: '1px solid var(--border-control)',
        }}
      >
        <Wrench size={18} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  )
}
