TECH_NAMES = {
    '0': 'Banking',
    '1': 'Experimentation',
    '2': 'Manufacturing',
    '3': 'Range',
    '4': 'Scanning',
    '5': 'Weapons',
    '6': 'Terraforming',
}


def summarize(snapshot):
    data = snapshot.get('data') or {}
    players = sorted((data.get('players') or {}).values(), key=lambda item: item.get('totalStars', 0), reverse=True)
    return {
        'gameName': snapshot.get('gameName') or data.get('name') or 'Unknown game',
        'tick': data.get('tick') or snapshot.get('tick') or 0,
        'productionCounter': data.get('productionCounter') or 0,
        'productionRate': data.get('productionRate') or 0,
        'playerUid': data.get('playerUid'),
        'players': players,
    }


def diff_snapshots(previous, current):
    if not previous or not current:
        return []
    events = []
    prev_players = (previous.get('data') or {}).get('players') or {}
    curr_players = (current.get('data') or {}).get('players') or {}

    for uid, player in curr_players.items():
        prev = prev_players.get(uid)
        name = player.get('alias') or f'Player {uid}'
        if not prev:
            events.append(event('player_new', f'{name} appeared in scan data.', 'info', {'playerUid': uid, 'playerName': name}))
            continue
        add_number_delta(events, player, prev, 'totalStrength', 'ships')
        add_number_delta(events, player, prev, 'totalStars', 'stars')
        add_number_delta(events, player, prev, 'totalEconomy', 'economy')
        add_number_delta(events, player, prev, 'totalIndustry', 'industry')
        add_number_delta(events, player, prev, 'totalScience', 'science')

        for kind, tech in (player.get('tech') or {}).items():
            prev_level = ((prev.get('tech') or {}).get(kind) or {}).get('level')
            level = tech.get('level')
            if isinstance(prev_level, int) and isinstance(level, int) and level > prev_level:
                tech_name = TECH_NAMES.get(str(kind), f'Tech {kind}')
                events.append(event('tech_up', f'{name} upgraded {tech_name} from {prev_level} to {level}.', 'success', {
                    'playerUid': uid,
                    'playerName': name,
                    'tech': tech_name,
                    'from': prev_level,
                    'to': level,
                }))

    diff_stars(events, previous, current)
    return events[:80]


def strategic_intel(summary, events):
    insights = []
    captures = [item for item in events if item['type'] == 'star_owner']
    player_delta_events = [item for item in events if item.get('details', {}).get('playerName')]

    for name, count in group_counts(captures, lambda item: item['details'].get('afterOwnerName')):
        insights.append(intel('offensive', f'{name} is expanding by conquest.', f'{name} captured {count} known star{"" if count == 1 else "s"} in the selected comparison window.', 'danger'))

    for name, count in group_counts(captures, lambda item: item['details'].get('beforeOwnerName')):
        if name != 'unowned':
            insights.append(intel('pressure', f'{name} is under pressure.', f'{name} lost {count} known star{"" if count == 1 else "s"} in the selected comparison window.', 'warning'))

    ship_losses = sorted([item for item in player_delta_events if item['type'] == 'totalStrength' and item['details']['delta'] < 0], key=lambda item: item['details']['delta'])
    for item in ship_losses[:3]:
        insights.append(intel('combat', f'{item["details"]["playerName"]} probably fought or overextended.', f'{item["details"]["playerName"]} lost {abs(item["details"]["delta"])} total ships between scans.', 'warning'))

    for item in [event_item for event_item in events if event_item['type'] == 'tech_up'][:5]:
        insights.append(intel('tech', f'{item["details"]["playerName"]} changed strategic capability.', f'{item["details"]["tech"]} advanced from {item["details"]["from"]} to {item["details"]["to"]}.', 'info'))

    if not insights:
        insights.append(intel('quiet', 'No major strategic change detected yet.', 'Once scans capture different ticks, this panel will highlight captures, pressure, ship losses, tech spikes, and visible wars.', 'info'))
    return insights[:12]


def add_number_delta(events, player, prev, field, label):
    before = int(prev.get(field) or 0)
    after = int(player.get(field) or 0)
    delta = after - before
    if delta:
        name = player.get('alias') or f'Player {player.get("uid")}'
        verb = 'gained' if delta > 0 else 'lost'
        tone = 'success' if delta > 0 else 'danger'
        events.append(event(field, f'{name} {verb} {abs(delta)} {label} since last scan.', tone, {
            'playerUid': player.get('uid'),
            'playerName': name,
            'field': field,
            'label': label,
            'before': before,
            'after': after,
            'delta': delta,
        }))


def diff_stars(events, previous, current):
    prev_data = previous.get('data') or {}
    curr_data = current.get('data') or {}
    prev_stars = prev_data.get('stars') or (prev_data.get('galaxy') or {}).get('stars') or {}
    curr_stars = curr_data.get('stars') or (curr_data.get('galaxy') or {}).get('stars') or {}
    prev_players = prev_data.get('players') or {}
    curr_players = curr_data.get('players') or {}

    for uid, star in curr_stars.items():
        prev = prev_stars.get(uid)
        if not prev:
            continue
        before_owner_uid = star_owner(prev)
        after_owner_uid = star_owner(star)
        if before_owner_uid != after_owner_uid:
            name = star.get('n') or star.get('name') or f'Star {uid}'
            before_owner = owner_name(before_owner_uid, prev_players)
            after_owner = owner_name(after_owner_uid, curr_players)
            events.append(event('star_owner', f'{name} changed owner from {before_owner} to {after_owner}.', 'warning', {
                'starUid': uid,
                'starName': name,
                'beforeOwnerUid': before_owner_uid,
                'afterOwnerUid': after_owner_uid,
                'beforeOwnerName': before_owner,
                'afterOwnerName': after_owner,
            }))


def star_owner(star):
    return star.get('playerUid', star.get('puid', star.get('playerId', star.get('owner', star.get('ownedBy')))))


def owner_name(uid, players):
    if uid is None or int(uid) < 0:
        return 'unowned'
    return (players.get(str(uid)) or {}).get('alias') or f'Player {uid}'


def group_counts(items, get_key):
    counts = {}
    for item in items:
        key = get_key(item)
        if key:
            counts[key] = counts.get(key, 0) + 1
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)


def intel(type_, title, detail, tone):
    return {'type': type_, 'title': title, 'detail': detail, 'tone': tone}


def event(type_, message, tone, details=None):
    return {'type': type_, 'message': message, 'tone': tone, 'details': details or {}}
