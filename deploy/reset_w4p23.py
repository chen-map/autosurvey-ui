import json

p = '/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/w4_state.json'
d = json.load(open(p, encoding='utf-8'))
for ph in d['phases']:
    if ph['id'] in ('W4-P2', 'W4-P3'):
        ph['status'] = 'pending'
        for k in ('started_at', 'ended_at', 'duration_sec', 'rc', 'error'):
            ph.pop(k, None)
d['current'] = None
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('P2/P3 reset ok')
