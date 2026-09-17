"""AutoSurvey Pipeline API 薄壳测试（不依赖真实脚本）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # type: ignore
