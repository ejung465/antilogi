import type { FeedItem } from '../hooks/useBridge'

function time(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}

export function EventFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="muted">Waiting for events — hold the thumb button and swipe, or press Test above.</p>
  }
  return (
    <ul className="feed">
      {[...items].reverse().map((item) => (
        <li key={item.id} className={`feed-${item.kind} ${item.level ? `feed-${item.level}` : ''}`}>
          <span className="feed-time">{time(item.at)}</span>
          <span className="feed-text">{item.text}</span>
        </li>
      ))}
    </ul>
  )
}
