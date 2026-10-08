/** Weather tool backed by the same cached main-process service used by desktop widgets. */
import { tool } from 'ai'
import { z } from 'zod'
import { fetchWeatherSnapshot } from '../../../services/weather-service'

export const weatherTool = tool({
  description:
    '查询实时天气和未来几天预报。用户问天气、气温、要不要带伞、穿什么时使用；没说城市时自动按用户当前位置查询。返回 ok=false 表示这次没查到，不要编造天气。',
  inputSchema: z.object({
    city: z.string().trim().max(120).optional().describe('城市名，如“杭州”“北京朝阳”。不填则使用用户当前位置。'),
    days: z.number().int().min(1).max(7).default(3).describe('预报天数，1-7 天，默认 3 天。'),
  }),
  execute: async ({ city, days }) => {
    const snapshot = await fetchWeatherSnapshot({ city, days })
    if (!snapshot.ok || !snapshot.current) {
      return {
        ok: false,
        message: snapshot.error || '天气服务暂时没有返回数据。',
        userMessage: snapshot.error || '天气服务暂时没有返回数据。',
        location: snapshot.location,
      }
    }
    return {
      ok: true,
      location: snapshot.location,
      usedUserLocation: snapshot.usedUserLocation,
      current: {
        temperature: `${snapshot.current.temperature}°C`,
        feelsLike: `${snapshot.current.apparentTemperature}°C`,
        humidity: `${snapshot.current.humidity}%`,
        weather: snapshot.current.weather,
        wind: `${snapshot.current.windSpeed}km/h`,
      },
      forecast: snapshot.forecast.map((item) => ({
        date: item.date,
        weather: item.weather,
        tempMax: `${item.tempMax}°C`,
        tempMin: `${item.tempMin}°C`,
        precipitation: `${item.precipitation}mm`,
        windMax: `${item.windMax}km/h`,
      })),
    }
  },
})
