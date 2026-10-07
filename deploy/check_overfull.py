import re
import subprocess

r = subprocess.run(['/home/G2024hq/asv-app/backend/tools/tectonic', 'main.tex'],
                   cwd='/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper',
                   capture_output=True, text=True, timeout=600)
out = (r.stdout or '') + (r.stderr or '')
for line in out.splitlines():
    if 'Overfull' in line and '274' in line:
        print(line[:160])
