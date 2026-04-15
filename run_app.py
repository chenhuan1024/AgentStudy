import socket
import threading
import time
import traceback
import webbrowser
import os
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import uvicorn
from uvicorn.config import LOGGING_CONFIG

from backend.app.main import app


def build_log_path() -> Path:
    log_dir = Path(__file__).resolve().parent / "backend" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"


def build_uvicorn_log_config(log_path: Path) -> dict:
    cfg = deepcopy(LOGGING_CONFIG)
    cfg.setdefault("formatters", {})
    cfg["formatters"]["default"] = {
        "()": "uvicorn.logging.DefaultFormatter",
        "fmt": "%(asctime)s [%(levelprefix)s] %(message)s",
        "use_colors": False,
    }
    cfg["formatters"]["access"] = {
        "()": "uvicorn.logging.AccessFormatter",
        "fmt": '%(asctime)s [%(levelprefix)s] %(client_addr)s - "%(request_line)s" %(status_code)s',
        "use_colors": False,
    }
    cfg.setdefault("handlers", {})
    cfg["handlers"]["file"] = {
        "class": "logging.FileHandler",
        "formatter": "default",
        "filename": str(log_path),
        "encoding": "utf-8",
    }
    cfg["handlers"]["file_access"] = {
        "class": "logging.FileHandler",
        "formatter": "access",
        "filename": str(log_path),
        "encoding": "utf-8",
    }
    cfg.setdefault("loggers", {})
    for name in ("uvicorn", "uvicorn.error"):
        handlers = set(cfg["loggers"].get(name, {}).get("handlers", []))
        handlers.update({"default", "file"})
        cfg["loggers"].setdefault(name, {})["handlers"] = list(handlers)
    access_handlers = set(cfg["loggers"].get("uvicorn.access", {}).get("handlers", []))
    access_handlers.update({"access", "file_access"})
    cfg["loggers"].setdefault("uvicorn.access", {})["handlers"] = list(access_handlers)
    return cfg


def find_free_port(start_port: int = 8000, max_tries: int = 20) -> int:
    for port in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("未找到可用端口")


def open_local_page(port: int) -> None:
    time.sleep(1.2)
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    log_path = build_log_path()
    print(f"[run_app] 日志文件: {log_path}")
    try:
        port = find_free_port(8000, 20)
        os.environ["APP_RUNTIME_PORT"] = str(port)
        os.environ["APP_RUNTIME_LOG"] = str(log_path)
        threading.Thread(target=open_local_page, args=(port,), daemon=True).start()
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            log_config=build_uvicorn_log_config(log_path),
        )
    except KeyboardInterrupt:
        raise
    except Exception as exc:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(f"\n[run_app] FATAL: {exc}\n")
            f.write(traceback.format_exc())
            f.write("\n")
        traceback.print_exc()
        try:
            input(f"后端启动失败，日志已写入: {log_path}，按 Enter 关闭窗口...")
        except EOFError:
            pass
        raise SystemExit(1) from None
