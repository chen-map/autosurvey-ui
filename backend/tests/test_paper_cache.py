"""论文标识符级缓存测试：DOI 去重、arXiv 键、命中计数。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from w1.paper_cache import PaperCache, key_for  # noqa: E402


def test_doi相同只算一篇(tmp_path: Path):
    cache = PaperCache(str(tmp_path / "cache.sqlite3"))
    rec = {"title": "Same Paper", "doi": "10.1038/x", "source_db": "arxiv"}
    assert cache.upsert({**rec, "source_db": "arxiv"}) is True
    assert cache.upsert({**rec, "source_db": "openalex"}) is False  # 同 DOI 不同来源 → 命中
    assert cache.count() == 1


def test_arxiv_id与标题键(tmp_path: Path):
    cache = PaperCache(str(tmp_path / "c.sqlite3"))
    assert cache.upsert({"title": "X", "url": "https://arxiv.org/abs/2401.0001"}) is True
    assert cache.upsert({"title": "X", "url": "https://arxiv.org/abs/2401.0001"}) is False
    assert cache.upsert({"title": "Y"}) is True
    assert cache.count() == 2


def test_键生成优先级():
    assert key_for({"doi": "10.1/x"}).startswith("doi:")
    assert key_for({"url": "https://arxiv.org/abs/1"}).startswith("arxiv:")
    assert key_for({"title": "Only Title"}).startswith("title:")


def test_无标识不缓存():
    cache = PaperCache(str(tmp_path_checker()))
    assert cache.upsert({"title": ""}) is False
    assert cache.count() == 0


def tmp_path_checker():
    import tempfile
    return Path(tempfile.mkdtemp()) / "c.sqlite3"
