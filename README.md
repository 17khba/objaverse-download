# Objaverse 下载工具

一个用于从 Objaverse 数据集下载和处理 3D 对象的 Python 包。

## 概述

该工具提供了一个简单的接口，用于从 [Objaverse 数据集](https://huggingface.co/datasets/allenai/objaverse) 下载 3D 对象，该数据集包含大量 GLB 格式的 3D 模型。该包处理元数据加载、并行下载和本地缓存。

## 功能特性

- 从 Objaverse 数据集下载 3D 对象
- 加载对象元数据和注释
- 支持使用多进程进行并行下载
- 本地缓存以避免重复下载
- 支持 LVIS 类别注释

## 使用方法

### 基本用法

```python
import objaverse_download

# 加载所有可用的 UID
uids = objaverse_download.load_uids()

# 加载特定对象的元数据
annotations = objaverse_download.load_annotations(uids[:10])

# 下载对象（下载到 ~/.objaverse/）
objects = objaverse_download.load_objects(uids[:10], download_processes=4)

# 加载 LVIS 注释
lvis_annotations = objaverse_download.load_lvis_annotations()
```

### 运行脚本

#### 使用 uv（推荐）

```bash
# 运行主下载脚本
uv run python objaverse_download.py

# 或者使用定义的脚本入口点
uv run objaverse-download

# 运行测试脚本
uv run python test_download.py

# 或者使用定义的测试入口点
uv run objaverse-test
```

#### 传统方式

```bash
python objaverse_download.py
```

这将会：
1. 从数据集加载对象路径
2. 从第一批（000-000）中选择 500 个对象
3. 使用 10 个并行进程下载元数据和 3D 模型

### 快速测试

如果想要快速测试下载功能，可以尝试下载少量对象：

```python
# 快速测试下载 5 个对象
import objaverse_download

# 获取前 5 个 UID
uids = objaverse_download.load_uids()[:5]
print(f"准备下载 {len(uids)} 个对象")

# 下载对象
objects = objaverse_download.load_objects(uids, download_processes=2)
print(f"成功下载 {len(objects)} 个对象")

# 打印下载的文件路径
for uid, path in objects.items():
    print(f"UID: {uid} -> 路径: {path}")
```

或者创建一个简单的测试脚本 `test_download.py`：

```python
#!/usr/bin/env python3
import objaverse_download

def test_download():
    """测试下载功能"""
    print("开始测试 Objaverse 下载功能...")
    
    # 获取少量 UID 进行测试
    all_uids = objaverse_download.load_uids()
    test_uids = all_uids[:3]  # 只下载 3 个对象进行测试
    
    print(f"将下载 {len(test_uids)} 个测试对象")
    
    # 下载对象
    objects = objaverse_download.load_objects(test_uids, download_processes=1)
    
    print(f"测试完成！成功下载 {len(objects)} 个对象：")
    for uid, path in objects.items():
        print(f"  - {uid}: {path}")

if __name__ == "__main__":
    test_download()
```

然后运行：

#### 使用 uv
```bash
uv run python test_download.py
# 或者
uv run objaverse-test
```

#### 传统方式
```bash
python test_download.py
```

### 分片下载

项目提供了一个强大的分片下载工具，支持手动配置下载范围和自定义文件结构：

#### 基本用法

```bash
# 使用 uv（推荐）
uv run objaverse-shard --start 0 --end 100 --output ./my_models

# 传统方式
python shard_download.py --start 0 --end 100 --output ./my_models
```

#### 高级选项

```bash
# 指定并行进程数
uv run objaverse-shard --start 0 --end 100 -p 8

# 按前缀过滤（只下载特定批次）
uv run objaverse-shard --start 0 --end 100 -f "000-000"

# 干运行模式（查看将要下载的对象数量）
uv run objaverse-shard --start 0 --end 100 --dry-run

# 完整示例
uv run objaverse-shard \
  --start 0 \
  --end 500 \
  --output ./downloads \
  --processes 6 \
  --filter "000-001"
```

#### 自定义文件结构

分片下载工具会自动重新组织文件结构：

```
downloads/
└── model/
    ├── 84/
    │   ├── 8476c4170df24cf5bbe6967222d1a42d.glb           # 3D模型文件
    │   ├── 8476c4170df24cf5bbe6967222d1a42d.m.metadata.json # 模型元数据
    │   ├── 8476c4170df24cf5bbe6967222d1a42d.thumb.jpeg     # 缩略图（如果有）
    │   ├── 84xxxxx.glb                                      # 其他84开头的文件
    │   └── 84xxxxx.m.metadata.json
    └── 8f/
        ├── 8ff7f1f2465347cd8b80c9b206c2781e.glb
        ├── 8ff7f1f2465347cd8b80c9b206c2781e.m.metadata.json
        └── 8ff7f1f2465347cd8b80c9b206c2781e.thumb.jpeg
```

每个对象使用其 UID 的前2位作为目录名，包含：
- **GLB文件**：3D模型主文件
- **元数据文件**：完整的对象信息（JSON格式）
- **缩略图**：对象的预览图片（如果可用）

#### 下载日志

工具会在输出目录生成详细的下载日志：
```
downloads/download_log_0_100.json
```

包含下载参数、每个对象的处理结果和统计信息。

## 函数说明

- `load_uids()`: 获取所有可用的对象 UID
- `load_annotations(uids)`: 加载指定 UID 的元数据
- `load_objects(uids, download_processes)`: 下载 3D 对象
- `load_lvis_annotations()`: 加载 LVIS 类别注释

## 存储位置

下载的文件存储在 `~/.objaverse/hf-objaverse-v1/` 目录下：
- 元数据：`metadata/`
- 3D 对象：`glbs/`
- 对象路径：`object-paths.json.gz`
- LVIS 注释：`lvis-annotations.json.gz`

## 安装

### 使用 uv（推荐）

确保已安装 [uv](https://docs.astral.sh/uv/)：

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 克隆项目
git clone <repository-url>
cd objaverse-download

# 创建虚拟环境并安装依赖
uv sync

# 激活虚拟环境
source .venv/bin/activate  # Linux/macOS
# 或
.venv\Scripts\activate     # Windows
```

### 传统安装方式

```bash
pip install -r requirements.txt
```

## 依赖要求

- Python 3.8+
- tqdm
- 标准库模块：glob, gzip, json, multiprocessing, os, urllib.request, warnings

## 开发

### 开发环境设置

```bash
# 克隆项目
git clone <repository-url>
cd objaverse-download

# 使用 uv 创建开发环境
uv sync --dev

# 激活虚拟环境
source .venv/bin/activate  # Linux/macOS
```

### 代码格式化和检查

```bash
# 格式化代码
uv run black .

# 类型检查
uv run mypy .

# 运行测试
uv run pytest
```

## 数据集

Objaverse 数据集托管在 Hugging Face 上，包含数十万个 3D 对象。该工具从以下地址下载：
`https://huggingface.co/datasets/allenai/objaverse/`