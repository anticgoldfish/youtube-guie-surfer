"""Portable, absolute-UTC TV programming for the website and future Android TV app.

A channel is created with 100 hours of EPG. GitHub Actions runs every 30 minutes,
checks the actual saved channels (no fixed number), and proactively replenishes each
lineup before it expires. Repeats keep a populated channel on air if YouTube fails.
"""
import hashlib
import random

HALF_HOUR_MS = 30 * 60 * 1000
CYCLE_MS = 72 * 60 * 60 * 1000
HORIZON_MS = 100 * 60 * 60 * 1000
EARLY_REPLENISH_MS = 52 * 60 * 60 * 1000
URGENT_REPLENISH_MS = 28 * 60 * 60 * 1000
STAGGER_SLOTS = 48  # 24 hours of half-hour slots; independent of channel count


def next_cycle(anchor, now_ms):
    anchor = int(anchor or 0)
    return anchor + ((int(now_ms) - anchor) // CYCLE_MS + 1) * CYCLE_MS


def channel_slot(channel):
    # IDs are stable even when a channel is renumbered or channels are added/deleted.
    identifier = str(channel.get('id') or channel.get('number') or '')
    digest = hashlib.sha256(identifier.encode()).digest()
    return int.from_bytes(digest[:4], 'big') % STAGGER_SLOTS


def schedule_end(channel, now_ms):
    """Latest saved EPG boundary relevant to this channel, if present."""
    ends = [int(epg['end']) for epg in (channel.get('schedule'), channel.get('nextSchedule'))
            if isinstance(epg, dict) and epg.get('end') is not None and int(epg['end']) > now_ms]
    return max(ends, default=0)


def refresh_due(channel, now_ms, force=False):
    if force:
        return True
    # Brand new channels missing a portable schedule are initialized immediately.
    end = schedule_end(channel, now_ms)
    if not end:
        return True
    remaining = end - now_ms
    if remaining > EARLY_REPLENISH_MS:
        return False
    # Spread new network calls over the next 24 hours. At <=28h remaining,
    # fall back to an unconditional attempt so a missed GitHub run can catch up.
    if remaining <= URGENT_REPLENISH_MS:
        return True
    return (int(now_ms) // HALF_HOUR_MS) % STAGGER_SLOTS == channel_slot(channel)


def build_schedule(channel, pool, start_ms, horizon_ms=HORIZON_MS):
    """Build exactly >=100 continuous hours; rerun finite pools as necessary."""
    eligible = [v for v in pool if v.get('id') and int(v.get('duration') or 0) > 0]
    if not eligible:
        return None
    entries = []
    cursor = int(start_ms)
    finish = cursor + max(int(horizon_ms), HORIZON_MS)
    pass_no = 0
    while cursor < finish:
        sequence = eligible.copy()
        if channel.get('order') == 'shuffle' and len(sequence) > 1:
            key = f"{channel.get('id')}|{start_ms}|{pass_no}".encode()
            rng = random.Random(int.from_bytes(hashlib.sha256(key).digest()[:8], 'big'))
            rng.shuffle(sequence)
        for video in sequence:
            length = int(video['duration']) * 1000
            end = min(cursor + length, finish)
            entries.append({'videoId': video['id'], 'start': cursor, 'end': end})
            cursor = end
            if cursor >= finish:
                break
        pass_no += 1
    return {'schemaVersion': 1, 'start': int(start_ms), 'end': finish,
            'durationHours': (finish - int(start_ms)) / 3600000, 'programs': entries}
