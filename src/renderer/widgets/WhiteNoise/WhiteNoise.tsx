import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, Car, CloudRain, Coffee, Disc, Fan, Flame, Pause, Play, Timer,
  Trees, Volume, Volume1, Volume2, VolumeX, Waves, Wind,
} from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { COLOR_THEMES } from '../shared/constants'
import { toRendererPublicUrl } from '@shared/asset-url'
import { useWidgetCommands } from '../shared/widgetCommandBus'
import { WHITE_NOISE_MAX_TIMER_MINUTES, WHITE_NOISE_SOUND_LABELS, WHITE_NOISE_TIMER_PRESETS } from '@shared/widget-command'

const SOUNDS = [
  { id: 'rain', icon: <CloudRain size={16} />, label: WHITE_NOISE_SOUND_LABELS.rain, url: toRendererPublicUrl('audio/Water.WAV') },
  { id: 'ocean', icon: <Waves size={16} />, label: WHITE_NOISE_SOUND_LABELS.ocean, url: toRendererPublicUrl('audio/Wave.WAV') },
  { id: 'waterfall', icon: <Waves size={16} className="rotate-90" />, label: WHITE_NOISE_SOUND_LABELS.waterfall, url: toRendererPublicUrl('audio/Waterfall.WAV') },
  { id: 'forest', icon: <Trees size={16} />, label: WHITE_NOISE_SOUND_LABELS.forest, url: toRendererPublicUrl('audio/Birdsong.WAV') },
  { id: 'fire', icon: <Flame size={16} />, label: WHITE_NOISE_SOUND_LABELS.fire, url: toRendererPublicUrl('audio/Fireplace.WAV') },
  { id: 'wind', icon: <Wind size={16} />, label: WHITE_NOISE_SOUND_LABELS.wind, url: toRendererPublicUrl('audio/Wind.WAV') },
  { id: 'coffee', icon: <Coffee size={16} />, label: WHITE_NOISE_SOUND_LABELS.coffee, url: toRendererPublicUrl('audio/CoffeeShop.WAV') },
  { id: 'street', icon: <Car size={16} />, label: WHITE_NOISE_SOUND_LABELS.street, url: toRendererPublicUrl('audio/Street.WAV') },
  { id: 'fan', icon: <Fan size={16} />, label: WHITE_NOISE_SOUND_LABELS.fan, url: toRendererPublicUrl('audio/Fan.WAV') },
  { id: 'white_noise', icon: <Activity size={16} />, label: WHITE_NOISE_SOUND_LABELS.white_noise, url: toRendererPublicUrl('audio/WhiteNoise.WAV') },
  { id: 'brown_noise', icon: <Disc size={16} />, label: WHITE_NOISE_SOUND_LABELS.brown_noise, url: toRendererPublicUrl('audio/BrownNoise.WAV') },
]

const VOLUMES = [0, 0.3, 0.6, 1]
const FADE_STEPS = 20
const FADE_STEP_MS = 200

function formatRemaining(ms: number): string {
  if (ms <= 60_000) return `${Math.max(0, Math.ceil(ms / 1000))} 秒`
  return `${Math.ceil(ms / 60_000)} 分钟`
}

interface WhiteNoiseWidgetProps {
  config?: Record<string, unknown>
}

export function WhiteNoiseWidget({ config }: WhiteNoiseWidgetProps) {
  const style = (config?.style as string) || 'glass'
  const themeId = (config?.themeId as string) || 'white'
  const darkMode = (config?.darkMode as boolean) ?? false
  const opacity = (config?.opacity as number) ?? 1
  const volumeProp = (config?.volume as number) ?? 2

  const [isPlaying, setIsPlaying] = useState(false)
  const [activeSound, setActiveSound] = useState('rain')
  const [volumeLevel, setVolumeLevel] = useState(volumeProp)
  const [showMenu, setShowMenu] = useState(false)
  // Sleep timer: when it runs out the sound fades for a few seconds, then stops.
  const [stopAt, setStopAt] = useState<number | null>(null)
  const [timerMinutes, setTimerMinutes] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const fadeRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const soundListRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (volumeProp !== undefined && volumeProp !== volumeLevel) setVolumeLevel(volumeProp)
  }, [volumeLevel, volumeProp])

  // The companion can start or stop the sound ("放点雨声") without touching stored config.
  const cancelFade = useCallback(() => {
    if (fadeRef.current !== null) window.clearInterval(fadeRef.current)
    fadeRef.current = null
  }, [])

  const setTimer = (minutes: number) => {
    const clamped = Math.max(0, Math.min(WHITE_NOISE_MAX_TIMER_MINUTES, Math.round(minutes)))
    setTimerMinutes(clamped)
    setStopAt(clamped > 0 ? Date.now() + clamped * 60_000 : null)
    setNow(Date.now())
  }

  const stop = useCallback(() => {
    cancelFade()
    setIsPlaying(false)
    setStopAt(null)
    setTimerMinutes(0)
  }, [cancelFade])

  // The companion can start or stop the sound ("放点雨声", "30 分钟后关掉") without touching stored config.
  useWidgetCommands('whitenoise', (command) => {
    if (command.command === 'pause') {
      stop()
      return
    }
    cancelFade()
    if (command.sound && SOUNDS.some((sound) => sound.id === command.sound)) setActiveSound(command.sound)
    if (command.volumeLevel && command.volumeLevel >= 1 && command.volumeLevel <= 3) setVolumeLevel(command.volumeLevel)
    if (typeof command.minutes === 'number') setTimer(command.minutes)
    setIsPlaying(true)
  })

  useEffect(() => {
    if (!stopAt || !isPlaying) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [stopAt, isPlaying])

  useEffect(() => {
    if (!stopAt || !isPlaying || now < stopAt || fadeRef.current !== null) return
    const audio = audioRef.current
    const startVolume = audio?.volume ?? 0
    let step = 0
    fadeRef.current = window.setInterval(() => {
      step += 1
      if (audio) audio.volume = Math.max(0, startVolume * (1 - step / FADE_STEPS))
      if (step >= FADE_STEPS) stop()
    }, FADE_STEP_MS)
  }, [now, stopAt, isPlaying, stop])

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.loop = true
      audioRef.current.onerror = () => setIsPlaying(false)
    }
    const audio = audioRef.current
    if (!audio) return
    const sound = SOUNDS.find((s) => s.id === activeSound)
    if (sound && audio.src !== sound.url) {
      const wasPlaying = !audio.paused
      audio.src = sound.url
      if (wasPlaying || isPlaying) audio.play().catch(() => {})
    }
    audio.volume = VOLUMES[volumeLevel]
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false))
    } else {
      audio.pause()
    }
  }, [activeSound, isPlaying, volumeLevel])

  useEffect(() => {
    return () => {
      if (fadeRef.current !== null) window.clearInterval(fadeRef.current)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  const toggleVolume = (e: React.MouseEvent) => {
    e.stopPropagation()
    setVolumeLevel((prev) => (prev + 1) % 4)
  }

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setShowMenu(true)
  }

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => setShowMenu(false), 300)
  }

  const currentSound = SOUNDS.find((s) => s.id === activeSound)
  const remainingMs = stopAt && isPlaying ? Math.max(0, stopAt - now) : null
  const timerFraction = remainingMs !== null && timerMinutes > 0 ? Math.min(1, remainingMs / (timerMinutes * 60_000)) : 0
  const getVolumeIcon = () => {
    if (volumeLevel === 0) return <VolumeX size={14} />
    if (volumeLevel === 1) return <Volume size={14} />
    if (volumeLevel === 2) return <Volume1 size={14} />
    return <Volume2 size={14} />
  }

  const getButtonStyle = () => {
    switch (style) {
      case 'cd': return darkMode ? 'bg-gradient-to-tr from-slate-800 via-slate-700 to-slate-800 border-slate-700 ring-white/10' : 'bg-gradient-to-tr from-slate-200 via-white to-slate-300 border-slate-300 ring-white/50'
      case 'minimal': return darkMode ? 'bg-slate-900 border-slate-800 shadow-xl ring-white/5' : 'bg-white border-slate-100 shadow-xl ring-black/5'
      case 'glass': default: return darkMode ? 'bg-black/40 border-white/10 shadow-xl ring-black/20' : 'bg-white/40 border-white/20 shadow-xl ring-white/10'
    }
  }

  const getCoreStyle = () => {
    const themeColor = COLOR_THEMES.find(t => t.id === themeId)
    if (themeColor && themeId !== 'white') return ''
    switch (style) {
      case 'cd': return 'bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 opacity-80'
      case 'minimal': return darkMode ? 'bg-slate-800' : 'bg-slate-200'
      case 'glass': default: return darkMode ? 'bg-black/30 border border-white/10' : 'bg-white/30 border border-white/20'
    }
  }

  const themeColor = COLOR_THEMES.find(t => t.id === themeId)
  const coreStyle = themeColor && themeId !== 'white' ? { background: themeColor.textGradient || themeColor.base } : {}
  const isColored = themeColor && themeId !== 'white'
  const iconColorClass = isColored || darkMode ? 'text-white/90' : 'text-slate-900'

  return (
    <div className="relative w-full h-full flex items-center justify-center" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div className="relative z-20">
        <button
          onMouseDown={(e) => { mouseDownPosRef.current = { x: e.clientX, y: e.clientY }; isDraggingRef.current = false }}
          onMouseMove={(e) => {
            if (mouseDownPosRef.current) {
              const distance = Math.sqrt(Math.pow(e.clientX - mouseDownPosRef.current.x, 2) + Math.pow(e.clientY - mouseDownPosRef.current.y, 2))
              if (distance > 5) isDraggingRef.current = true
            }
          }}
          onMouseUp={() => { mouseDownPosRef.current = null }}
          onClick={(e) => {
            if (isDraggingRef.current) { e.stopPropagation(); isDraggingRef.current = false; return }
            if (isPlaying) stop()
            else setIsPlaying(true)
          }}
          title={isPlaying ? `${currentSound?.label ?? ''}${remainingMs !== null ? ` · ${formatRemaining(remainingMs)}后停止` : ''}（点击暂停）` : `播放${currentSound?.label ?? '白噪音'}`}
          aria-label={isPlaying ? '暂停白噪音' : '播放白噪音'}
          className="group relative w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-transform active:scale-95 hover:scale-105"
        >
          {isPlaying && (
            <div className="absolute -inset-1 rounded-full border-2 border-white/60 animate-[ping_2.6s_cubic-bezier(0,0,0.2,1)_infinite] motion-reduce:hidden pointer-events-none" />
          )}
          <div className={`absolute inset-0 rounded-full border-[3px] shadow-xl group-hover:ring-2 transition-all duration-200 ${getButtonStyle()}`} style={{ opacity }} />
          {remainingMs !== null && (
            <svg className="absolute -inset-[3px] w-[54px] h-[54px] -rotate-90 pointer-events-none z-20" viewBox="0 0 54 54" aria-hidden="true">
              <circle cx="27" cy="27" r="25" fill="none" stroke="rgba(251,146,60,0.95)" strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 25} strokeDashoffset={2 * Math.PI * 25 * (1 - timerFraction)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
            </svg>
          )}
          <div className="relative z-10 w-full h-full flex items-center justify-center">
            <div className={`absolute w-8 h-8 rounded-full shadow-inner flex items-center justify-center ${!themeColor || themeId === 'white' ? getCoreStyle() : ''} ${isPlaying ? 'animate-[spin_4s_linear_infinite]' : ''}`} style={coreStyle}>
              <div className={`${iconColorClass} drop-shadow-md opacity-90 transform scale-75 group-hover:opacity-0 transition-opacity duration-200`}>{currentSound?.icon}</div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-0 group-hover:opacity-100">
              {isPlaying ? <Pause size={16} className={`${iconColorClass} fill-current drop-shadow-lg`} /> : <Play size={16} className={`${iconColorClass} fill-current drop-shadow-lg ml-0.5`} />}
            </div>
          </div>
        </button>
      </div>

      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'circOut' }}
            className={`absolute bottom-full mb-4 w-48 ${darkMode ? 'bg-black/60 border-white/10' : 'bg-white/60 border-white/20'} backdrop-blur-xl border rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col right-0 origin-bottom-right`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-3 py-1.5 border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-black/5 bg-black/5'}`}>
              <span className={`text-[10px] font-bold tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>音量 {Math.round(VOLUMES[volumeLevel] * 100)}%</span>
              <button onClick={toggleVolume} className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${darkMode ? 'bg-white/10 hover:bg-white/20 text-slate-300' : 'bg-black/5 hover:bg-black/10 text-slate-700'}`} title="切换音量档位">
                {getVolumeIcon()}
              </button>
            </div>
            <div ref={soundListRef} className="max-h-[160px] overflow-y-auto p-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; e.stopPropagation() }}>
              {SOUNDS.map((sound) => (
                <button
                  key={sound.id}
                  onClick={(e) => { e.stopPropagation(); setActiveSound(sound.id) }}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-xl text-xs transition-all ${activeSound === sound.id ? (darkMode ? 'bg-white/20 text-white font-medium' : 'bg-black/5 text-slate-900 font-medium') : (darkMode ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-black/5 hover:text-slate-900')}`}
                >
                  <span className={activeSound === sound.id ? (darkMode ? 'text-white' : 'text-slate-900') : 'opacity-70'}>{sound.icon}</span>
                  <span className="flex-1 text-left">{sound.label}</span>
                  {activeSound === sound.id && <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" />}
                </button>
              ))}
            </div>
            <div className={`px-3 py-2 border-t ${darkMode ? 'border-white/10' : 'border-black/5'}`}>
              <div className={`flex items-center gap-1.5 mb-1.5 text-[10px] font-bold tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                <Timer size={11} />
                <span>{remainingMs !== null ? `${formatRemaining(remainingMs)}后停止` : '定时关闭'}</span>
              </div>
              <div className="flex gap-1">
                {[0, ...WHITE_NOISE_TIMER_PRESETS].map((minutes) => {
                  const active = minutes === 0 ? stopAt === null : stopAt !== null && timerMinutes === minutes
                  return (
                    <button
                      key={minutes}
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelFade()
                        setTimer(minutes)
                        if (minutes > 0) setIsPlaying(true)
                      }}
                      className={`flex-1 py-1 rounded-lg text-[10.5px] transition-colors ${active ? 'bg-orange-400 text-white font-semibold' : darkMode ? 'bg-white/10 text-slate-300 hover:bg-white/20' : 'bg-black/5 text-slate-600 hover:bg-black/10'}`}
                    >
                      {minutes === 0 ? '关' : minutes}
                    </button>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
