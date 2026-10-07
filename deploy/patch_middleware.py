# -*- coding: utf-8 -*-
"""修 _HtmlNoCache 内存滞留：__init__ 读取并缓存 index.html → dist 换血后 HTTP 层返回旧版。
改为按 mtime 惰性重读。"""
import ast

P = 'backend/api/main.py'
s = open(P, encoding='utf-8').read()

old = '''    class _HtmlNoCache(BaseHTTPMiddleware):
        def __init__(self, app2, dist: Path):
            super().__init__(app2)
            self._html = (dist / "index.html").read_bytes() if (dist / "index.html").exists() else b""

        async def dispatch(self, request, call_next):
            if request.url.path in ("/", "/index.html") or request.url.path.endswith(".html"):
                from fastapi.responses import Response
                return Response(content=self._html, media_type="text/html",
                                headers={"Cache-Control": "no-cache", "ETag": f'"{hash(self._html) & 0xffffffff:x}"'})
            return await call_next(request)'''
new = '''    class _HtmlNoCache(BaseHTTPMiddleware):
        def __init__(self, app2, dist: Path):
            super().__init__(app2)
            self._dist = dist
            self._cache: tuple = (0.0, b"")  # (mtime, bytes)——按 mtime 惰性重读，防 dist 换血后内存滞留旧版

        def _html(self) -> bytes:
            f = self._dist / "index.html"
            try:
                mt = f.stat().st_mtime
                if mt != self._cache[0]:
                    self._cache = (mt, f.read_bytes())
            except OSError:
                pass
            return self._cache[1]

        async def dispatch(self, request, call_next):
            if request.url.path in ("/", "/index.html") or request.url.path.endswith(".html"):
                from fastapi.responses import Response
                html = self._html()
                return Response(content=html, media_type="text/html",
                                headers={"Cache-Control": "no-cache", "ETag": f'"{hash(html) & 0xffffffff:x}"'})
            return await call_next(request)'''
assert s.count(old) == 1
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='\n').write(s)
ast.parse(s)
print('middleware OK')
