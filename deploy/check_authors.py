import json

n = a = 0
for line in open('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/retrieval_workspace/w5_workspace/knowledge_graph/structured_papers.jsonl', encoding='utf-8'):
    r = json.loads(line)
    n += 1
    if r.get('authors'):
        a += 1
print(f'structured {n} 条，含 authors {a} 条')
bib = open('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper/references.bib', encoding='utf-8').read()
import re
print('纯ID标题残留:', len(re.findall(r'title = \{\d+\}', bib)))
print('Anonymous 残留:', bib.count('author = {Anonymous}'))
print('真实作者样例:', re.findall(r'author = \{[^A][^}]{5,60}\}', bib)[:2])
