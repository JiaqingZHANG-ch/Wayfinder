"""python -m server：启动后端。HOST、PORT、MODEL、APP_DB、PLAN_TEMPLATE 都从环境变量读。"""
import os

import uvicorn

from .api import app_from_env

# 默认只让本机访问；第 5 周用手机连时设 HOST=0.0.0.0
uvicorn.run(app_from_env(), host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
