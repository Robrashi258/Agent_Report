export function localDay(value = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}
export function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d)
}
export function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
export function minute(value: string): number { const [h, m] = value.split(':').map(Number); return h * 60 + m }
export function formatTime(value: number): string { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) }
export function inputDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
}
