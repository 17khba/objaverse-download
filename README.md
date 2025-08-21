# Objaverse 下载工具

一个用于从 Objaverse 数据集下载和处理 3D 对象的 Python 包，提供完整的下载管理系统。

## 📖 目录

- [概述](#概述)
- [快速开始](#快速开始)
- [安装](#安装)
- [核心功能](#核心功能)
  - [基本下载](#基本下载)
  - [分片下载](#分片下载)
  - [失败重试](#失败重试)
  - [日志分析](#日志分析)
- [云存储上传](#云存储上传)
- [完整工作流程](#完整工作流程)
- [API 参考](#api-参考)
- [故障排除](#故障排除)
- [开发指南](#开发指南)

## 📝 概述

该工具提供了一个完整的 3D 模型下载管理系统，支持从 [Objaverse 数据集](https://huggingface.co/datasets/allenai/objaverse) 批量下载 GLB 格式的 3D 模型。

### 主要特性

- 🚀 **高效下载**：支持多进程并行下载
- 🔄 **智能重试**：自动处理网络错误和超时
- 📊 **日志管理**：详细的下载记录和分析工具
- 🗂️ **文件组织**：自动整理文件结构
- 🛠️ **故障恢复**：从失败中断点续传
- ☁️ **云存储支持**：支持上传到阿里云 OSS，含超时优化重试机制

## 🚀 快速开始

### 1. 基本测试下载
```bash
# 快速测试：下载 3 个模型
uv run objaverse-test
```

### 2. 分片下载
```bash
# 下载 100 个模型到指定目录
uv run objaverse-shard --start 0 --end 100 --output ./my_models
```

### 3. 处理下载失败
```bash
# 查看失败记录
uv run objaverse-filter download_log_0_100.json --show-failed

# 重试失败的下载
uv run objaverse-retry download_log_0_100.json
```

## 💾 安装

### 使用 uv（推荐）

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 克隆项目
git clone <repository-url>
cd objaverse-download

# 安装依赖
uv sync
```

### 传统方式

```bash
pip install -r requirements.txt
```

**系统要求**：Python 3.8+

## 🎯 核心功能

### 基本下载

#### Python API 使用

```python
import objaverse_download

# 获取可用的模型 UID
uids = objaverse_download.load_uids()

# 下载前 10 个模型
objects = objaverse_download.load_objects(uids[:10], download_processes=4)

# 加载模型元数据
annotations = objaverse_download.load_annotations(uids[:10])
```

#### 命令行使用

```bash
# 基本下载
uv run objaverse-download

# 测试下载
uv run objaverse-test
```

### 分片下载

分片下载是核心功能，支持精确控制下载范围和并发。

#### 基本语法

```bash
uv run objaverse-shard --start <开始索引> --end <结束索引> [选项]
```

#### 常用选项

| 参数 | 说明 | 示例 |
|------|------|------|
| `--start` | 开始索引 | `--start 0` |
| `--end` | 结束索引 | `--end 100` |
| `--output` | 输出目录 | `--output ./downloads` |
| `--processes` | 并发进程数 | `--processes 6` |
| `--filter` | 批次过滤器 | `--filter "000-001"` |
| `--dry-run` | 预览模式 | `--dry-run` |

#### 使用示例

```bash
# 基础下载
uv run objaverse-shard --start 0 --end 100 --output ./models

# 高并发下载
uv run objaverse-shard --start 0 --end 500 --processes 8

# 按批次过滤
uv run objaverse-shard --start 0 --end 100 --filter "000-001"

# 预览下载内容
uv run objaverse-shard --start 0 --end 100 --dry-run
```

#### 文件结构

下载后的文件按 UID 前缀自动组织：

```
downloads/
└── model/
    ├── 84/
    │   ├── 8476c4170df24cf5bbe6967222d1a42d.glb           # 3D模型
    │   ├── 8476c4170df24cf5bbe6967222d1a42d.m.metadata.json # 元数据
    │   └── 8476c4170df24cf5bbe6967222d1a42d.thumb.jpeg     # 缩略图
    └── 8f/
        ├── 8ff7f1f2465347cd8b80c9b206c2781e.glb
        └── 8ff7f1f2465347cd8b80c9b206c2781e.m.metadata.json
```

### 失败重试

智能重试系统可以自动处理网络问题和下载失败。

#### 基本重试

```bash
# 查看失败记录
uv run objaverse-retry download_log_100_200.json --list-only

# 使用默认设置重试
uv run objaverse-retry download_log_100_200.json
```

#### 自定义重试参数

```bash
# 增加重试次数和间隔
uv run objaverse-retry download_log_100_200.json \
  --max-retries 5 \
  --retry-delay 10

# 指定输出目录
uv run objaverse-retry download_log_100_200.json \
  --output ./retry_downloads
```

#### 常见错误处理

| 错误类型 | 原因 | 解决方案 |
|---------|------|---------|
| `SSL: UNEXPECTED_EOF_WHILE_READING` | SSL连接问题 | 增加重试次数和间隔 |
| `Connection timed out` | 网络超时 | 使用更长的重试间隔 |
| `Remote end closed connection` | 服务器连接中断 | 减少并发数，分批重试 |
| `retrieval incomplete` | 下载不完整 | 检查网络稳定性 |

### 日志分析

强大的日志分析工具帮助您了解下载状态和问题。

#### 查看失败详情

```bash
# 按错误类型分组显示失败记录
uv run objaverse-filter download_log_100_200.json --show-failed
```

#### 过滤日志记录

```bash
# 提取失败记录（默认）
uv run objaverse-filter download_log_100_200.json

# 提取成功记录
uv run objaverse-filter download_log_100_200.json --keep-success

# 生成重试建议
uv run objaverse-filter download_log_100_200.json --suggest-retry
```

#### 示例输出

```
失败的下载记录 (6 个):
--------------------------------------------------------------------------------

错误类型: <urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol (_ssl.c:1000)>
影响的对象数量: 2
UID列表:
  d028274cfd2e46da91ae709892e82ebe
  1c5917c1e9d147a984725886fc917ea7

重新下载建议:
  失败对象总数: 6
  建议并发数: 2 (已减少以提高稳定性)
  建议命令:
    uv run objaverse-retry filtered_failed_download_log_100_200.json --max-retries 5 --retry-delay 10
```

## ☁️ 云存储上传

下载完成的模型可以上传到阿里云 OSS 进行存储和分发。

### 上传配置

首先配置环境变量（创建 `.env` 文件）：

```bash
# 阿里云 OSS 配置
OSS_REGION=oss-cn-beijing
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_BUCKET=your_bucket_name

# 可选配置
OSS_BUCKET_PATH=model/          # 存储路径前缀
UPLOAD_CONCURRENT=5             # 上传并发数
UPLOAD_RETRY=3                  # 重试次数
```

### 基本上传

```bash
# 安装 Node.js 依赖
npm install

# 上传模型文件到 OSS
node scripts/upload-model.js
```

### 处理上传失败

上传过程中可能遇到网络超时等问题，系统会自动记录失败日志。

```bash
# 重试失败的上传（推荐）
node scripts/retry-upload.js logs/upload-error.log
```

#### 重试脚本特性

- **超时优化**：增加连接和响应超时时间（5-10分钟）
- **智能分片**：根据文件大小动态调整分片大小（512KB-2MB）
- **降低并发**：减少并发数以提高稳定性
- **指数退避**：失败后延迟时间逐渐增加
- **详细报告**：生成上传成功率和失败原因统计

#### 重试脚本环境变量

```bash
# 重试配置（可选，在 .env 中配置）
RETRY_DELAY=5000               # 重试延迟（毫秒）
UPLOAD_CONCURRENT=2            # 重试时并发数（建议不超过2）
UPLOAD_RETRY=5                 # 最大重试次数
```

### 上传工作流程

```bash
# 完整的上传工作流程
# 1. 首次上传
node scripts/upload-model.js

# 2. 检查失败日志
cat logs/upload-error.log

# 3. 重试失败的文件
node scripts/retry-upload.js logs/upload-error.log

# 4. 查看重试报告
cat logs/retry-upload-report-*.json
```

## 🔄 完整工作流程

### 1. 大批量下载工作流

```bash
# 步骤1：分片下载
uv run objaverse-shard --start 0 --end 1000 --output ./downloads --processes 6

# 步骤2：检查失败记录
uv run objaverse-filter download_log_0_1000.json --show-failed

# 步骤3：重试失败下载
uv run objaverse-filter download_log_0_1000.json --suggest-retry
uv run objaverse-retry filtered_failed_download_log_0_1000.json --max-retries 5

# 步骤4：验证最终结果
uv run objaverse-filter retry_filtered_failed_download_log_0_1000.json --show-failed

# 步骤5：上传到云存储
node scripts/upload-model.js

# 步骤6：重试失败上传
node scripts/retry-upload.js logs/upload-error.log
```

### 2. 渐进式下载策略

```bash
# 小批量测试
uv run objaverse-shard --start 0 --end 50 --dry-run
uv run objaverse-shard --start 0 --end 50 --processes 2

# 中等批量
uv run objaverse-shard --start 50 --end 200 --processes 4

# 大批量下载
uv run objaverse-shard --start 200 --end 1000 --processes 6
```

### 3. 网络不稳定环境

```bash
# 使用较少的并发和更长的重试间隔
uv run objaverse-shard --start 0 --end 100 --processes 2

# 对失败记录使用更激进的重试策略
uv run objaverse-retry download_log.json \
  --max-retries 10 \
  --retry-delay 15
```

## 📚 API 参考

### 核心函数

| 函数 | 说明 | 参数 |
|------|------|------|
| `load_uids()` | 获取所有可用的对象 UID | 无 |
| `load_annotations(uids)` | 加载指定 UID 的元数据 | `uids`: UID列表 |
| `load_objects(uids, download_processes)` | 下载 3D 对象 | `uids`: UID列表, `download_processes`: 并发数 |
| `load_lvis_annotations()` | 加载 LVIS 类别注释 | 无 |

### 命令行工具

| 命令 | 功能 |
|------|------|
| `objaverse-download` | 基本下载脚本 |
| `objaverse-test` | 测试下载功能 |
| `objaverse-shard` | 分片下载工具 |
| `objaverse-retry` | 重试失败下载 |
| `objaverse-filter` | 日志分析工具 |

### 存储位置

- **默认缓存**：`~/.objaverse/hf-objaverse-v1/`
- **元数据**：`metadata/`
- **3D 对象**：`glbs/`
- **自定义下载**：用户指定的输出目录

## 🛠️ 故障排除

### 常见问题

**Q: 下载速度很慢怎么办？**
A: 适当增加 `--processes` 参数，但不要超过 8-10 个进程。

**Q: 经常出现 SSL 错误？**
A: 减少并发数，增加重试间隔：`--retry-delay 10`

**Q: 如何恢复中断的下载？**
A: 使用重试工具：`uv run objaverse-retry <log_file>`

**Q: 磁盘空间不够怎么办？**
A: 分批下载，每次下载较少的模型。

**Q: 上传到 OSS 时出现超时错误？**
A: 使用重试脚本：`node scripts/retry-upload.js logs/upload-error.log`，该脚本已优化超时设置和分片大小。

**Q: 如何减少上传失败率？**
A: 1) 降低并发数（设置 `UPLOAD_CONCURRENT=2`）；2) 增加重试延迟（设置 `RETRY_DELAY=10000`）；3) 使用重试脚本处理失败文件。

### 性能优化建议

1. **网络稳定**：使用 2-4 个并发进程
2. **网络良好**：可以使用 6-8 个并发进程
3. **大批量下载**：分成多个小批次
4. **失败重试**：使用较长的重试间隔

## 🔧 开发指南

### 开发环境设置

```bash
# 克隆并设置开发环境
git clone <repository-url>
cd objaverse-download
uv sync --dev

# 激活虚拟环境
source .venv/bin/activate  # Linux/macOS
```

### 代码规范

```bash
# 格式化代码
uv run black .

# 类型检查
uv run mypy .

# 运行测试
uv run pytest
```

### 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交代码
4. 创建 Pull Request

## 📄 许可证

MIT License

## 🔗 相关链接

- [Objaverse 数据集](https://huggingface.co/datasets/allenai/objaverse/)
- [UV 包管理器](https://docs.astral.sh/uv/)