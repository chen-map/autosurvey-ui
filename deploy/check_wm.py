import json
import pathlib

base = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/working_memory')
print('entries:', [d.name for d in sorted(base.glob('*'))])
for rq in sorted(base.glob('rq_*')):
    a = json.load(open(rq / 'answer_claims.json', encoding='utf-8'))
    oa = a.get('overall_answer') or ''
    head = oa[:70].replace('\n', ' ')
    print(f"{rq.name} | overall {len(oa)} 字 | claims {len(a.get('key_claims') or [])} 条 | {head}")
